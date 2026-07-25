"""Per-email observability trace for the Admin Center.

One row per email the pipeline saw, newest fetch first — BOTH the in-scope mail
that was captured (captured_events ⋈ comprehension_log) AND the mail the scope
gate rejected (triage_exclusions). The two are UNION-ed into one `trace` so the
table shows the full triage split (in scope / red zone / spam / out of scope).

Rejected mail is content-free by design (we never store the body/sender/subject
of mail we don't keep), so excluded rows carry their bucket + reason + date but
blank content and no comprehension metrics.

Cost is derived here (not stored per email): the comprehension receipt records
the actual input/output tokens + model, and prices.yaml gives the per-Mtok
price for that model, so cost = tokens x price. This is RAW provider cost in the
price sheet's currency — the API boundary (``app.py``) marks it up to the
customer-facing figure (``metering.to_customer_facing``), exactly as the Usage
endpoints do, so internal repos stay in raw units.
"""
from __future__ import annotations

import psycopg
from psycopg import sql

from src.billing import metering

# Hard ceiling on a page so a huge mailbox can't return everything at once.
MAX_LIMIT = 200

# Sortable columns → the column of the UNION-ed `trace` they map to. Validated
# against this whitelist, so a request can never inject an ORDER BY expression.
# (Cost is derived in Python from tokens × price, so it isn't server-sortable.)
_SORT_COLUMNS: dict[str, sql.Composable] = {
    "fetched": sql.SQL("fetched_at"),
    "sender": sql.SQL("sender"),
    "subject": sql.SQL("subject"),
    "bucket": sql.SQL("bucket"),
    "processed": sql.SQL("processed_at"),
    "entities": sql.SQL("entities_found"),
    "relationships": sql.SQL("relationships"),
    "in_tokens": sql.SQL("input_tokens"),
    "out_tokens": sql.SQL("output_tokens"),
    "llm_calls": sql.SQL("llm_calls"),
    "model": sql.SQL("model"),
    "duplicate_hits": sql.SQL("duplicate_hits"),
}

# Case-insensitive substring filter across these `trace` columns. Excluded rows
# have null content, so for them the filter effectively matches bucket/reason.
_FILTER_COLUMNS = (
    "sender", "subject", "body_text", "participants::text", "model", "bucket", "reason",
)

# The UNION of in-scope captures and rejected mail, exposing one common column
# set. Excluded rows fill content/metric columns with NULL.
_TRACE_CTE = sql.SQL(
    """
    WITH trace AS (
        SELECT
            ce.id                                   AS id,
            'captured'                              AS kind,
            'in_scope'                              AS bucket,
            NULL::text                              AS reason,
            ce.ingested_at                          AS fetched_at,
            ce.sender                               AS sender,
            ce.participants                         AS participants,
            ce.subject                              AS subject,
            ce.body_text                            AS body_text,
            ce.processed_at                         AS processed_at,
            cl.entities_found                       AS entities_found,
            cl.input_tokens                         AS input_tokens,
            cl.output_tokens                        AS output_tokens,
            cl.llm_calls                            AS llm_calls,
            cl.model                                AS model,
            (SELECT count(*) FROM comprehension_relationships cr
               WHERE cr.comprehension_id = cl.id)   AS relationships,
            (SELECT count(*) FROM capture_duplicates cd
               WHERE cd.source = ce.source
                 AND cd.external_id = ce.external_id) AS duplicate_hits,
            (cl.debug_trace IS NOT NULL)            AS has_debug,
            cs.provider                             AS provider
        FROM captured_events ce
        LEFT JOIN comprehension_log cl ON cl.captured_event_id = ce.id
        LEFT JOIN capture_runs cr ON cr.id = ce.capture_run_id
        LEFT JOIN capture_sources cs ON cs.mailbox = cr.mailbox
        WHERE ce.source = 'email'
        UNION ALL
        SELECT
            te.id, 'excluded', te.bucket, te.reason, te.excluded_at,
            NULL::text, NULL::jsonb, NULL::text, NULL::text,
            NULL::timestamptz, NULL::integer, NULL::bigint, NULL::bigint,
            NULL::integer, NULL::text, NULL::bigint, 0, FALSE,
            cs.provider
        FROM triage_exclusions te
        LEFT JOIN capture_runs cr ON cr.id = te.run_id
        LEFT JOIN capture_sources cs ON cs.mailbox = cr.mailbox
        WHERE te.source = 'email'
    )
    """
)


def _cost_order_expr(models: dict) -> tuple[sql.Composable, list]:
    """A SQL expression that computes each row's LLM cost from the price sheet, so
    the derived Cost column can be sorted server-side across the whole table.

    cost = input_tokens/1e6 × input_price(model) + output_tokens/1e6 × output_price(model)

    Returns (expression, params). Model names are passed as parameters (never
    interpolated). Rows with no/unknown model (e.g. excluded mail) fall to 0.
    """
    if not models:
        return sql.SQL("0"), []
    whens: list = []
    params: list = []
    for model, price in models.items():
        whens.append(
            sql.SQL(
                "WHEN %s THEN ("
                "COALESCE(input_tokens,0)/1000000.0*%s + "
                "COALESCE(output_tokens,0)/1000000.0*%s)"
            )
        )
        params += [
            model,
            float(price.get("input", 0) or 0),
            float(price.get("output", 0) or 0),
        ]
    expr = (
        sql.SQL("(CASE model ") + sql.SQL(" ").join(whens) + sql.SQL(" ELSE 0 END)")
    )
    return expr, params


def cost_by_document(conn: psycopg.Connection) -> dict:
    """Per-document token + cost rollup for comprehended Drive files.

    Groups ``comprehension_log`` (joined to its captured file) by filename — for a
    file the captured event's ``subject`` IS the filename and ``source='file'`` —
    summing input/output tokens and the derived LLM cost (tokens × prices.yaml),
    ordered most-expensive first. Lets an admin see which documents are the most
    token- and credit-hungry. The INNER JOIN means only CURRENT files count (a
    re-ingested/edited file's superseded comprehension drops out). Cost is derived
    per model, so it's rolled up in Python across models.
    """
    sheet = metering.read_price_sheet()
    models = sheet.get("models", {})
    currency = sheet.get("currency", "USD")

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ce.subject, cl.model,
                   count(*),
                   COALESCE(SUM(cl.input_tokens), 0),
                   COALESCE(SUM(cl.output_tokens), 0),
                   COALESCE(SUM(cl.entities_found), 0),
                   COALESCE(SUM(cl.llm_calls), 0),
                   COALESCE(SUM((SELECT count(*) FROM comprehension_relationships cr
                                   WHERE cr.comprehension_id = cl.id)), 0)
            FROM comprehension_log cl
            JOIN captured_events ce ON ce.id = cl.captured_event_id
            WHERE ce.source = 'file'
            GROUP BY ce.subject, cl.model;
            """
        )
        raw = cur.fetchall()

    by_file: dict[str, dict] = {}
    for subject, model, n, in_tok, out_tok, ents, calls, rels in raw:
        name = subject or "(unnamed file)"
        agg = by_file.setdefault(
            name,
            {
                "filename": name,
                "comprehensions": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "entities": 0,
                "relationships": 0,
                "llm_calls": 0,
                "cost": 0.0,
                # Representative model = the one that did the most token work on
                # this file (a file re-comprehended under a new model is rare).
                "model": None,
                "_model_tok": -1,
            },
        )
        agg["comprehensions"] += int(n or 0)
        agg["input_tokens"] += int(in_tok or 0)
        agg["output_tokens"] += int(out_tok or 0)
        agg["entities"] += int(ents or 0)
        agg["relationships"] += int(rels or 0)
        agg["llm_calls"] += int(calls or 0)
        tok = int(in_tok or 0) + int(out_tok or 0)
        if model and tok > agg["_model_tok"]:
            agg["model"] = model
            agg["_model_tok"] = tok
        price = models.get(model or "", {})
        agg["cost"] += (
            int(in_tok or 0) / 1_000_000 * float(price.get("input", 0) or 0)
            + int(out_tok or 0) / 1_000_000 * float(price.get("output", 0) or 0)
        )

    rows = sorted(by_file.values(), key=lambda r: r["cost"], reverse=True)
    for r in rows:
        r["cost"] = round(r["cost"], 6)
        r.pop("_model_tok", None)
    return {"currency": currency, "rows": rows}


def email_trace(
    conn: psycopg.Connection,
    *,
    limit: int = 50,
    offset: int = 0,
    sort_column: str | None = None,
    sort_dir: str | None = "desc",
    filter_q: str | None = None,
    provider: str | None = None,
) -> dict:
    """A paged, sortable, filterable trace of every email the pipeline saw.

    In-scope rows carry the capture fields (fetched date, sender, recipients,
    subject, body), duplicate re-fetch count, and — once comprehended — the
    entity/relationship yield, token/call fan-out, model, and derived cost.
    Excluded rows carry their triage bucket + reason + date, with blank content
    (rejected mail is never stored). Sort + filter run server-side over the whole
    table, not just the visible page.

    ``provider`` (``'graph'`` | ``'imap'``) restricts to one mail source type for
    the Ingress observability view, resolved per row via the capture run's mailbox
    → ``capture_sources.provider`` (captured rows by ``capture_run_id``, excluded
    rows by ``run_id``). A row whose mailbox no longer maps to a capture source
    (source deleted) has a NULL provider and is excluded when a provider filter is
    set — it still appears in the unfiltered view.
    """
    limit = max(1, min(MAX_LIMIT, limit))
    offset = max(0, offset)

    conds: list[sql.Composable] = []
    params: list[object] = []
    q = (filter_q or "").strip()
    if q:
        ors = [
            sql.SQL("COALESCE({}::text, '') ILIKE %s").format(sql.SQL(col))
            for col in _FILTER_COLUMNS
        ]
        conds.append(sql.SQL("(") + sql.SQL(" OR ").join(ors) + sql.SQL(")"))
        params += [f"%{q}%"] * len(_FILTER_COLUMNS)
    if provider:
        conds.append(sql.SQL("provider = %s"))
        params.append(provider)
    where = (
        sql.SQL(" WHERE ") + sql.SQL(" AND ").join(conds) if conds else sql.SQL("")
    )

    # Price sheet read once: drives both the (optional) server-side cost sort and
    # the per-row cost computed below.
    sheet = metering.read_price_sheet()
    models = sheet.get("models", {})
    currency = sheet.get("currency", "USD")

    # Cost is derived (tokens × price), not a stored column — so sorting on it
    # builds the cost expression in SQL from the price sheet. Everything else maps
    # to a real column via the validated whitelist.
    order_params: list[object] = []
    if (sort_column or "") == "cost":
        order_col, order_params = _cost_order_expr(models)
    else:
        order_col = _SORT_COLUMNS.get(sort_column or "", _SORT_COLUMNS["fetched"])
    direction = sql.SQL("ASC") if str(sort_dir).lower() == "asc" else sql.SQL("DESC")
    order = (
        sql.SQL(" ORDER BY ") + order_col + sql.SQL(" ") + direction
        + sql.SQL(" NULLS LAST, fetched_at DESC, id DESC")
    )

    with conn.cursor() as cur:
        cur.execute(
            _TRACE_CTE + sql.SQL("SELECT count(*) FROM trace") + where, params
        )
        total = cur.fetchone()[0]

        cur.execute(
            _TRACE_CTE
            + sql.SQL(
                "SELECT id, kind, bucket, reason, fetched_at, sender, participants, "
                "subject, body_text, processed_at, entities_found, input_tokens, "
                "output_tokens, llm_calls, model, relationships, duplicate_hits, "
                "has_debug, provider FROM trace"
            )
            + where
            + order
            + sql.SQL(" LIMIT %s OFFSET %s"),
            # order_params sit between the WHERE filters and LIMIT/OFFSET because
            # the cost expression lives in the ORDER BY clause.
            params + order_params + [limit, offset],
        )
        raw = cur.fetchall()

    rows: list[dict] = []
    for r in raw:
        (
            eid, kind, bucket, reason, fetched_at, sender, participants, subject,
            body, processed_at, entities, in_tok, out_tok, calls, model, rels,
            dup_hits, has_debug, provider,
        ) = r

        recipients = [p for p in (participants or []) if p != sender]
        processed = processed_at is not None
        cost = None
        if processed and model and model in models:
            price = models[model]
            cost = round(
                (in_tok or 0) / 1_000_000 * float(price.get("input", 0))
                + (out_tok or 0) / 1_000_000 * float(price.get("output", 0)),
                6,
            )

        rows.append(
            {
                "id": eid,
                "kind": kind,
                "fetched_at": fetched_at.isoformat() if fetched_at else None,
                "sender": sender,
                "recipients": recipients,
                "subject": subject,
                "body_text": body,
                "triage_bucket": bucket,
                "triage_reason": reason,
                "duplicate_hits": int(dup_hits or 0),
                "processed_at": processed_at.isoformat() if processed_at else None,
                "entities": entities if processed else None,
                "relationships": int(rels) if processed and rels is not None else None,
                "input_tokens": int(in_tok) if processed and in_tok is not None else None,
                "output_tokens": int(out_tok) if processed and out_tok is not None else None,
                "llm_calls": int(calls) if processed and calls is not None else None,
                "model": model if processed else None,
                "cost": cost,
                "currency": currency,
                # Whether a comprehend debug trace exists to expand (the
                # RelationshipAgent decisions, entities, and English text).
                "has_debug": bool(has_debug),
                # Mail source type this row came from ('graph' | 'imap' | None).
                "provider": provider,
            }
        )

    return {"rows": rows, "total": total, "limit": limit, "offset": offset}


def relationship_trace(
    conn: psycopg.Connection, captured_event_id: int
) -> dict | None:
    """The stored comprehend debug trace for one captured email, or None.

    Returns the JSONB blob written by the runner: the English text the agents
    saw, the entities that entered the fan-out, the header-grounded structural
    edges, and — per subject — the RelationshipAgent's candidates, raw model
    output, dropped unknown objects, accepted triples, and each raw→canonical
    predicate-normalization decision.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT debug_trace FROM comprehension_log WHERE captured_event_id = %s;",
            (captured_event_id,),
        )
        row = cur.fetchone()
    if not row or row[0] is None:
        return None
    return row[0]
