"""Comprehend+index driver: turn unprocessed captured_events into brain pages.

Drives the metered back half of ingestion. The cheap front half (capture +
triage, src/ingestion/capture/mail.py) runs often and lands captured_events
rows; this is the LLM-bound, credit-metered comprehend+index work, so we keep
it on its own cadence and let it resume. Each captured event runs through the
ComprehendPipeline; on success its row is stamped ``processed_at`` so it's
never comprehended twice.

The hard credit cap (metering.enforce_credit_limit, wired into every LLM call)
fires inside the pipeline. When an org is over its limit the pipeline raises
CreditLimitExceeded; we catch it and STOP cleanly (the unprocessed rows simply
wait), rather than hammering a capped org call after call.

Tenancy: ``conn`` is the tenant's brain DB (the caller owns it), and the
``pipeline`` it's paired with must be pinned to the same tenant
(``ComprehendPipeline(db_name=...)``) so the brain pages and the graph it
writes land in that tenant's brain, not the default one.
"""
from __future__ import annotations

from dataclasses import dataclass

import psycopg
from psycopg.types.json import Jsonb

from src import config, usage
from src.billing import metering
from src.ingestion.comprehend.pipeline import ComprehendResult


@dataclass
class ComprehensionSummary:
    processed: int = 0
    failed: int = 0
    stopped_on_limit: bool = False


def comprehend_pending(
    conn: psycopg.Connection,
    pipeline,
    *,
    limit: int | None = None,
) -> ComprehensionSummary:
    """Comprehend every unprocessed captured_event (oldest first) into the brain.

    Ingestion cost is attributed to the mailbox each email was captured from
    (joined via capture_runs): if that mailbox is a team member's own login
    address the cost folds into their row; a shared/ops mailbox shows on its
    own. The org is derived from the pipeline's tenant DB so this attribution
    holds on the scheduled/CLI path too, where no request set the ambient org.
    """
    sql = (
        "SELECT ce.id, ce.source, ce.occurred_at, ce.sender, ce.sender_name, "
        "       ce.recipients_to, ce.recipients_cc, ce.subject, ce.body_text, "
        "       cr.mailbox "
        "FROM captured_events ce "
        "LEFT JOIN capture_runs cr ON cr.id = ce.capture_run_id "
        "WHERE ce.processed_at IS NULL "
        "ORDER BY ce.occurred_at NULLS FIRST, ce.id"
    )
    if limit is not None:
        sql += f" LIMIT {int(limit)}"
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()

    # Which org owns this brain — so ingestion usage lands under the right
    # workspace (and resolves mailbox → member within it), even when no HTTP
    # request set the ambient org. Best-effort: None just means "unattributed".
    org_id = metering.org_id_for_db(pipeline.db_name) if getattr(pipeline, "db_name", None) else None
    org_tok = metering.set_current_org(org_id) if org_id is not None else None

    from src.ingestion.comprehend.pipeline import EmailContext
    from src.ingestion.comprehend import settings_store

    # Off by default: when the workspace hasn't opted into Drive comprehension,
    # leave file rows unprocessed (they're still searchable via their chunks), so
    # flipping the toggle on later comprehends the backlog.
    drive_comprehend = bool(settings_store.get_settings(conn).get("drive_comprehend_enabled"))

    summary = ComprehensionSummary()
    try:
        for (captured_event_id, source, occurred_at, sender, sender_name,
             recipients_to, recipients_cc, subject, body_text, mailbox) in rows:
            subject = subject or ""
            body_text = body_text or ""
            if not subject.strip() and not body_text.strip():
                _mark_processed(conn, captured_event_id)
                continue
            is_email = (source or "email") == "email"
            if not is_email and not drive_comprehend:
                # Drive comprehension is off — leave this file row unprocessed so a
                # later toggle-on picks it up. Its chunks already make it searchable.
                continue
            date = occurred_at.date().isoformat() if occurred_at else ""
            ctx = (
                EmailContext(
                    sender=sender, sender_name=sender_name,
                    recipients_to=list(recipients_to or []),
                    recipients_cc=list(recipients_cc or []),
                    subject=subject, body=body_text, date=date, mailbox=mailbox,
                    label=f"captured_event {captured_event_id}",
                )
                if is_email
                else None
            )
            body_chars = len(body_text) + len(subject)
            # Tag this item's LLM usage with the mailbox it came from, and fold
            # it into that mailbox's owner when one signs in as that address.
            owner_id = (
                metering.resolve_mailbox_user(org_id, mailbox)
                if (org_id is not None and mailbox)
                else None
            )
            mbx_tok = metering.set_current_source_mailbox(mailbox)
            usr_tok = metering.set_current_user(owner_id)
            # Comprehension is strictly serial and process_text blocks until this
            # item's entire thread fan-out has finished, so the delta of the
            # global usage counter across the call is exactly this item's token
            # and call cost (this is the only LLM activity here).
            before = usage.snapshot()
            try:
                if is_email:
                    result = pipeline.comprehend_email(ctx)
                else:
                    # A document: no email envelope — run the generic text path
                    # over the file's Markdown (filename leads as a title line).
                    doc_text = f"{subject}\n\n{body_text}" if subject.strip() else body_text
                    result = pipeline.process_text(
                        text=doc_text,
                        date=date,
                        label=f"captured_event {captured_event_id}",
                    )
            except metering.CreditLimitExceeded as exc:
                print(f"[comprehend] credit limit reached — stopping comprehension: {exc}")
                summary.stopped_on_limit = True
                break
            except Exception as exc:  # one bad captured event shouldn't halt the batch
                print(f"[comprehend] WARNING captured_event {captured_event_id} failed: {exc!r}")
                summary.failed += 1
                continue
            finally:
                metering.reset_current_user(usr_tok)
                metering.reset_current_source_mailbox(mbx_tok)
            after = usage.snapshot()
            # process_text already did (and committed) the expensive, billable
            # work: the brain pages, the graph, and the metered LLM spend. The
            # bookkeeping below (the comprehension receipt + provenance links) is
            # secondary. If it fails we must NOT (a) abort the whole batch or
            # (b) leave the event unprocessed — an unprocessed event is re-fetched
            # next cycle and the LLM spend is paid AGAIN. So: best-effort the
            # receipt, then ALWAYS mark processed so a receipt hiccup can never
            # turn into a credit-burning re-comprehend loop.
            try:
                comprehension_id = _record_metadata(
                    conn, captured_event_id, source, body_chars, result, before, after
                )
                _record_provenance(conn, comprehension_id, result)
            except Exception as exc:
                conn.rollback()  # clear the aborted txn so _mark_processed can run
                print(
                    f"[comprehend] WARNING receipt/provenance write failed for "
                    f"captured_event {captured_event_id}: {exc!r} — marking processed "
                    "anyway (pages already persisted) to avoid re-spending"
                )
            _mark_processed(conn, captured_event_id)
            summary.processed += 1
    finally:
        if org_tok is not None:
            metering.reset_current_org(org_tok)
    return summary


def _record_metadata(
    conn: psycopg.Connection,
    captured_event_id: int,
    source: str | None,
    body_chars: int,
    result: ComprehendResult,
    before: dict,
    after: dict,
) -> int:
    """Persist this item's measured fan-out + entity yield to comprehension_log.

    The token/call figures are the usage-counter delta across this item's
    serial process_text call (see comprehend_pending). UPSERT on the unique
    captured_event_id keeps it idempotent if a source event is re-processed.
    Returns the comprehension_log id, used to attach the provenance links.
    """
    llm_calls = after["calls"] - before["calls"]
    input_tokens = after["prompt_tokens"] - before["prompt_tokens"]
    output_tokens = after["completion_tokens"] - before["completion_tokens"]
    debug_trace = Jsonb(result.debug) if getattr(result, "debug", None) else None
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO comprehension_log (
                captured_event_id, source, body_chars,
                entities_found, entities_created, entities_updated,
                llm_calls, input_tokens, output_tokens, model, debug_trace
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (captured_event_id) DO UPDATE SET
                source           = EXCLUDED.source,
                body_chars       = EXCLUDED.body_chars,
                entities_found   = EXCLUDED.entities_found,
                entities_created = EXCLUDED.entities_created,
                entities_updated = EXCLUDED.entities_updated,
                llm_calls        = EXCLUDED.llm_calls,
                input_tokens     = EXCLUDED.input_tokens,
                output_tokens    = EXCLUDED.output_tokens,
                model            = EXCLUDED.model,
                debug_trace      = EXCLUDED.debug_trace,
                processed_at     = now()
            RETURNING id;
            """,
            (
                captured_event_id, source or "email", body_chars,
                result.entities_found, result.entities_created, result.entities_updated,
                llm_calls, input_tokens, output_tokens, config.LLM_BASE_MODEL or None,
                debug_trace,
            ),
        )
        comprehension_id: int = cur.fetchone()[0]
    conn.commit()
    return comprehension_id


def _record_provenance(
    conn: psycopg.Connection, comprehension_id: int, result: ComprehendResult
) -> None:
    """Link this comprehension to the pages, entities, and relationships it wrote.

    Wipe-and-rewrite on the comprehension_id so a re-processed event replaces
    its old links instead of accumulating them (mirrors the UPSERT in
    _record_metadata).

    comprehension_pages is the source-of-truth link: the brain pages this run
    created/updated, recorded unconditionally (the page is written before the
    graph is derived). comprehension_entities / comprehension_relationships are
    the derived graph-side view of the same work.
    """
    with conn.cursor() as cur:
        cur.execute(
            "DELETE FROM comprehension_pages WHERE comprehension_id = %s;",
            (comprehension_id,),
        )
        cur.execute(
            "DELETE FROM comprehension_entities WHERE comprehension_id = %s;",
            (comprehension_id,),
        )
        cur.execute(
            "DELETE FROM comprehension_relationships WHERE comprehension_id = %s;",
            (comprehension_id,),
        )
        if result.page_refs:
            cur.executemany(
                "INSERT INTO comprehension_pages "
                "(comprehension_id, page_path, action) VALUES (%s, %s, %s) "
                "ON CONFLICT (comprehension_id, page_path) DO UPDATE "
                "SET action = EXCLUDED.action;",
                [(comprehension_id, path, action) for path, action in result.page_refs],
            )
        if result.entity_refs:
            cur.executemany(
                "INSERT INTO comprehension_entities "
                "(comprehension_id, entity_id, action) VALUES (%s, %s, %s) "
                "ON CONFLICT (comprehension_id, entity_id) DO UPDATE "
                "SET action = EXCLUDED.action;",
                [(comprehension_id, eid, action) for eid, action in result.entity_refs],
            )
        if result.relationship_ids:
            cur.executemany(
                "INSERT INTO comprehension_relationships "
                "(comprehension_id, relationship_id) VALUES (%s, %s) "
                "ON CONFLICT (comprehension_id, relationship_id) DO NOTHING;",
                [(comprehension_id, rid) for rid in set(result.relationship_ids)],
            )
    conn.commit()


def _mark_processed(conn: psycopg.Connection, captured_event_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE captured_events SET processed_at = now() WHERE id = %s;",
            (captured_event_id,),
        )
    conn.commit()
