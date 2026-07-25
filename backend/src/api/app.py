"""Indigo Iota product API: EntraID SSO + session + role-gated routes.

Login flow (backend-driven):

    GET  /auth/{slug}/login   -> redirect the user to their Entra tenant
    GET  /auth/callback       -> verify, map to org+role, set session cookie
    GET  /auth/me             -> who am I (org + role)
    POST /auth/logout         -> clear the session
    POST /auth/dev-login      -> DEV ONLY (IOTA_DEV_LOGIN=1): session without Microsoft

Role gating is done with the ``current_user`` / ``require_role`` dependencies;
``/api/admin/ping`` is a worked example the Admin Center will build on.
"""
from __future__ import annotations

import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote

import httpx
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
)
from mcp.server.auth.provider import construct_redirect_uri
from pydantic import BaseModel

from src import audit, mailer, mcp_server
from src.auth import challenge, native_auth, oidc, service, sessions
from src.auth.passwords import WeakPasswordError
from src.db import inspector
from src.onboarding.access_policy import build_access_policy_command
from src.tenancy import provision

load_dotenv()


def _warm_embeddings() -> None:
    """Load the fastembed ONNX session at startup.

    The model is cached via @lru_cache in embeddings.py.  Loading it here
    (once, synchronously, before the server accepts traffic) avoids a sudden
    ~600 MB RAM spike the first time a request triggers classify() mid-flight —
    which on a small box can OOM-kill the worker before uvicorn logs the request.
    """
    import logging
    _log = logging.getLogger("iota.startup")
    _log.info("[startup] pre-warming embedding model …")
    from src.ingestion.index.embeddings import embed  # noqa: PLC0415
    embed(["warmup"])
    _log.info("[startup] embedding model ready.")


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """Run the remote MCP server's Streamable-HTTP session manager for the life
    of the API process. The MCP app is mounted at /mcp below; its session
    manager must be running for those requests to be served.

    We also pre-warm the embedding model here so classify() calls inside
    request handlers never trigger a cold load (see _warm_embeddings above).
    """
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _warm_embeddings)
    async with mcp_server.mcp.session_manager.run():
        yield


app = FastAPI(title="Indigo Iota API", lifespan=_lifespan)

# NOTE: the remote MCP app is mounted at the END of this module (see bottom),
# AFTER every API route is declared, so the catch-all mount only handles paths
# the API itself doesn't define.

# Where to send the user after a successful login (the Next.js frontend).
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")
# Public origin used to build emailed links (invite / password reset). Defaults
# to APP_BASE_URL; override with IOTA_PUBLIC_BASE_URL if the customer-facing host
# differs from the post-login app host.
LINK_BASE = (os.environ.get("IOTA_PUBLIC_BASE_URL") or APP_BASE_URL).rstrip("/")
# Cookies are marked Secure in production (HTTPS); off for local http dev.
COOKIE_SECURE = os.environ.get("IOTA_COOKIE_SECURE", "0") == "1"


def _set_cookie(resp: Response, name: str, value: str, max_age: int) -> None:
    resp.set_cookie(
        name, value,
        max_age=max_age, httponly=True, secure=COOKIE_SECURE,
        samesite="lax", path="/",
    )


@app.get("/healthz")
def healthz() -> dict:
    """Liveness probe for the edge proxy + container healthcheck.

    Deliberately cheap and unauthenticated: it does NOT touch the database or
    any tenant, so it stays green during a brief DB blip and never leaks state.
    """
    return {"status": "ok"}


# --- login flow -------------------------------------------------------------

@app.get("/auth/{slug}/login")
def login(slug: str, next: str = "/") -> Response:
    sso = service.get_sso_config(slug)
    if not sso:
        raise HTTPException(404, f"SSO is not configured for organization '{slug}'.")
    cfg, _org = sso

    state, nonce = oidc.new_state(), oidc.new_nonce()
    verifier, challenge = oidc.make_pkce()
    try:
        auth_url = oidc.build_authorization_url(
            cfg, state=state, nonce=nonce, code_challenge=challenge
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            502, "Could not reach the identity provider. Check the org's SSO configuration."
        ) from exc

    resp = RedirectResponse(auth_url, status_code=302)
    tx = sessions.issue_tx(
        state=state, nonce=nonce, code_verifier=verifier, org_slug=slug, next_url=next
    )
    _set_cookie(resp, sessions.TX_COOKIE_NAME, tx, max_age=sessions.TX_TTL)
    return resp


@app.get("/auth/callback")
def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> Response:
    if error:
        raise HTTPException(400, f"SSO error from Microsoft: {error} — {error_description}")

    tx = sessions.read_tx(request.cookies.get(sessions.TX_COOKIE_NAME))
    if not tx or not code or not state or state != tx.get("state"):
        raise HTTPException(400, "Invalid or expired login transaction.")

    sso = service.get_sso_config(tx["org"])
    if not sso:
        raise HTTPException(404, "SSO is not configured for this organization.")
    cfg, org = sso

    try:
        tokens = oidc.exchange_code(cfg, code=code, code_verifier=tx["cv"])
    except httpx.HTTPError as exc:
        raise HTTPException(
            502, "Could not reach the identity provider to exchange the code."
        ) from exc
    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(400, "No id_token returned by Microsoft.")
    try:
        claims = oidc.validate_id_token(cfg, id_token=id_token, nonce=tx["nonce"])
    except httpx.HTTPError as exc:
        raise HTTPException(
            502, "Could not reach the identity provider to validate the token."
        ) from exc
    except ValueError as exc:
        raise HTTPException(400, f"Invalid id_token: {exc}") from exc

    user_id = service.upsert_user_from_claims(claims, cfg.tenant_id)
    email = claims.get("email") or claims.get("preferred_username")
    role = service.resolve_role(user_id, org.org_id)
    if not role:
        audit.record_event(
            "login_denied",
            org_id=org.org_id,
            actor=email,
            detail={"method": "sso", "reason": "not_a_member", "user_id": user_id},
        )
        raise HTTPException(403, "You are not a member of this organization.")
    audit.record_event(
        "login",
        org_id=org.org_id,
        actor=email,
        detail={"method": "sso", "role": role, "user_id": user_id},
    )

    session = sessions.issue_session(
        user_id=user_id, org_id=org.org_id, org_slug=org.slug, role=role,
        email=email,
    )
    dest = tx.get("next") or "/"
    resp = RedirectResponse(APP_BASE_URL.rstrip("/") + dest, status_code=302)
    _set_cookie(resp, sessions.COOKIE_NAME, session, max_age=sessions.SESSION_TTL)
    resp.delete_cookie(sessions.TX_COOKIE_NAME, path="/")
    return resp


def _consent_done_page(title: str, message: str, ok: bool = True) -> Response:
    color = "#16a34a" if ok else "#dc2626"
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  body {{ font-family: system-ui, sans-serif; background:#faf9f7; color:#1c1917;
         display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }}
  .card {{ max-width:30rem; padding:2rem 2.25rem; border:1px solid #e7e5e4;
           border-radius:12px; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.06); }}
  h1 {{ font-size:1.15rem; margin:0 0 .5rem; color:{color}; }}
  p {{ font-size:.95rem; line-height:1.5; color:#44403c; margin:0; }}
</style></head>
<body><div class="card"><h1>{title}</h1><p>{message}</p></div></body></html>"""
    return Response(content=html, media_type="text/html", status_code=200 if ok else 400)


@app.get("/auth/consent-callback")
def consent_callback(
    admin_consent: str | None = None,
    tenant: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> Response:
    """Where Microsoft bounces the customer's admin after they grant sign-in
    consent. It carries ``?admin_consent=True&tenant=<dir id>&state=<slug>``.

    We read the tenant id off the URL and store it on the workspace named by the
    ``state`` slug, enabling sign-in — so no one has to type the tenant id. This
    page is shown to the admin, not the operator.
    """
    if error:
        return _consent_done_page(
            "Consent was not completed",
            f"Microsoft reported: {error_description or error}. "
            "You can close this tab and try the link again.",
            ok=False,
        )
    slug = (state or "").strip()
    # state="connector"/"login" are the generic (untagged) fallbacks — nothing to
    # record, just acknowledge.
    if not tenant or slug in ("", "connector", "login"):
        return _consent_done_page(
            "Access granted",
            "Thanks — access has been granted. You can close this tab.",
        )
    client_id = os.environ.get("SSO_CLIENT_ID", "").strip()
    if not client_id:
        return _consent_done_page(
            "Almost there",
            "Sign-in consent was granted, but this deployment is missing its "
            "Login app id (SSO_CLIENT_ID). Let your Indigo Iota contact know.",
            ok=False,
        )
    try:
        service.set_sso_connection(
            slug,
            tenant_id=tenant.strip(),
            client_id=client_id,
            redirect_uri=APP_BASE_URL.rstrip("/") + "/auth/callback",
            enabled=True,
        )
    except ValueError:
        return _consent_done_page(
            "Workspace not found",
            "We couldn't match this consent to a workspace. Let your Indigo "
            "Iota contact know.",
            ok=False,
        )
    return _consent_done_page(
        "Sign-in is set up",
        "Your organization can now sign in to Indigo Iota with Microsoft. "
        "You can close this tab.",
    )


@app.post("/auth/logout")
def logout() -> Response:
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(sessions.COOKIE_NAME, path="/")
    return resp


# --- auth dependencies ------------------------------------------------------

def current_user(request: Request) -> dict:
    raw = request.cookies.get(sessions.COOKIE_NAME)
    data = sessions.read_session(raw)
    if not data:
        # TEMP DIAGNOSTIC: say WHY a request is unauthenticated so we can tell
        # apart "browser sent no cookie" (host/path/SameSite) from "cookie
        # present but rejected" (bad signature / expired). Remove once solved.
        import logging
        reason = sessions.auth_failure_reason(raw)
        logging.getLogger("iota.auth").warning(
            "401 on %s | host=%r | cookie_present=%s | reason=%s",
            request.url.path,
            request.headers.get("host"),
            bool(raw),
            reason,
        )
        raise HTTPException(401, "Not authenticated.")
    return data


def _session_user_id(user: dict) -> int | None:
    """The signed-in member's id, read from the session's "sub" claim (a string,
    see sessions.issue_session). Returns None if absent or non-int so callers
    can attribute spend to the org alone rather than to a wrong/zero member.
    """
    try:
        return int(user["sub"])
    except (KeyError, TypeError, ValueError):
        return None


def require_role(*roles: str):
    def dependency(user: dict = Depends(current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(403, "Insufficient role for this action.")
        return user
    return dependency


def require_owner(user: dict = Depends(current_user)) -> dict:
    """Platform-owner gate for the Control Tower. The owner is cross-org (no
    membership), so this is a separate role from the per-org 'admin'/'member'.
    """
    if user.get("role") != "owner":
        raise HTTPException(403, "Platform owner access required.")
    return user


@app.get("/auth/me")
def me(user: dict = Depends(current_user)) -> dict:
    return {
        "email": user.get("email"),
        "org": user.get("org"),
        "org_id": user.get("org_id"),
        "role": user.get("role"),
        # So the Admin Center can branch member management on the sign-in model:
        # 'native' orgs invite by email (set-password link), 'entra' orgs add a
        # member who then signs in with Microsoft.
        "auth_method": native_auth.auth_method_for_org(user.get("org") or ""),
    }


@app.get("/api/admin/ping")
def admin_ping(user: dict = Depends(require_role("admin"))) -> dict:
    """Worked example of an admin-only route (the Admin Center builds on this)."""
    return {"ok": True, "org": user["org"], "role": user["role"]}


# --- Agent swarm ------------------------------------------------------------
# Start/stop a loop of agents that read the brain and investigate where value is
# leaking; the Overview renders the live log + hypothesis tree they produce.

@app.get("/api/swarm/status")
def swarm_status(user: dict = Depends(current_user)) -> dict:
    from src.agents import swarm

    return swarm.status(_tenant_db_for(user["org_id"]))


@app.get("/api/swarm/log")
def swarm_log(
    since: int = Query(0, ge=0), user: dict = Depends(current_user)
) -> dict:
    from src.agents import swarm

    return swarm.get_log(_tenant_db_for(user["org_id"]), since=since)


@app.get("/api/swarm/tree")
def swarm_tree(user: dict = Depends(current_user)) -> dict:
    from src.agents import swarm

    return swarm.get_tree(_tenant_db_for(user["org_id"]))


@app.post("/api/swarm/start")
async def swarm_start(user: dict = Depends(require_role("admin"))) -> dict:
    from src.agents import swarm

    return await swarm.start(
        _tenant_db_for(user["org_id"]), user.get("org") or "your workspace"
    )


@app.post("/api/swarm/stop")
async def swarm_stop(user: dict = Depends(require_role("admin"))) -> dict:
    from src.agents import swarm

    return await swarm.stop(_tenant_db_for(user["org_id"]))


def _money(value) -> str:
    """Render a Decimal cost as a stable string (never float — it's money)."""
    return str(value)


def _markup_cost(raw, factor=None):
    """Raw provider cost (float|None) → customer-facing credits (1 credit = $1).

    The observability repo derives RAW cost from tokens × price sheet; this is the
    API-boundary markup (``metering.to_customer_facing``) so the Admin Center shows
    what the customer is actually billed — same factor as the Usage panel and
    credits ledger. ``factor`` is the workspace's per-org markup (``markup_for``);
    omit for the global default. Returns a float rounded to 6 dp, or None."""
    if raw is None:
        return None
    from decimal import Decimal

    from src.billing import metering

    return round(float(metering.to_customer_facing(Decimal(str(raw)), factor)), 6)


@app.get("/api/admin/usage")
def admin_usage(user: dict = Depends(require_role("admin"))) -> dict:
    """What the project brain has actually produced for the caller's org.

    Customer-facing on purpose: plain counts of work delivered (emails/files
    analyzed, entities mapped, questions answered) — NOT LLM calls, tokens, or
    cost. Those are internal mechanics no customer should parse; spend lives in
    the credits panel instead.
    """
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM captured_events WHERE source = 'email';")
        emails = cur.fetchone()[0]
        # Of those in-scope emails, how many the comprehend step has actually
        # turned into brain content (processed_at is stamped on comprehension).
        cur.execute(
            "SELECT count(*) FROM captured_events "
            "WHERE source = 'email' AND processed_at IS NOT NULL;"
        )
        emails_processed = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM captured_events WHERE source = 'file';")
        files = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM entities;")
        entities = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM relationships;")
        connections = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM questions;")
        questions = cur.fetchone()[0]

        # How every email branched through the two-layer scope gate. Only
        # in-scope mail becomes a captured_events row, so `emails` IS the
        # in-scope leaf; the other branches live in triage_exclusions,
        # split by bucket and the Layer-1/Layer-2 flag.
        cur.execute(
            """
            SELECT bucket, layer2_applied, count(*)
              FROM triage_exclusions
             WHERE source = 'email'
             GROUP BY bucket, layer2_applied;
            """
        )
        rz_l1 = rz_l2 = spam = out_of_scope = 0
        for bucket, layer2_applied, n in cur.fetchall():
            if bucket == "redzone":
                if layer2_applied:
                    rz_l2 += n
                else:
                    rz_l1 += n
            elif bucket == "spam":
                spam += n
            elif bucket == "out_of_scope":
                out_of_scope += n

    # Layer 1 sorts into four buckets; an email lands in_scope at Layer 1 if it
    # was ultimately included OR only knocked out by the Layer-2 runoff. Layer 2
    # is the redzone-vs-in_scope runoff under that in_scope branch.
    scope_tree = {
        "layer1": {
            "in_scope": emails + rz_l2,
            "redzone": rz_l1,
            "spam": spam,
            "out_of_scope": out_of_scope,
        },
        "layer2": {
            "in_scope": emails,
            "redzone": rz_l2,
        },
    }
    return {
        "org": user["org"],
        "emails_analyzed": emails,
        "emails_processed": emails_processed,
        "files_analyzed": files,
        "entities_mapped": entities,
        "connections": connections,
        "questions_answered": questions,
        "scope_tree": scope_tree,
    }


@app.get("/api/admin/observability")
def admin_observability(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str | None = Query(None),
    dir: str = Query("desc"),
    q: str | None = Query(None),
    provider: str | None = Query(None),
    user: dict = Depends(require_role("admin")),
) -> dict:
    """Per-email observability trace for the caller's workspace: capture fields +
    triage outcome + duplicate hits + (once processed) the entity/relationship
    yield, token/call fan-out, model, and derived cost. Sort + filter are
    server-side so they span the whole table, not just the page.

    ``provider`` (``graph`` | ``imap``) scopes the trace to one mail source type
    for the Ingress observability view.

    The repo's per-row cost is RAW provider cost; here at the API boundary it's
    marked up to the customer-facing figure (1 credit = $1), consistent with the
    Usage panel and the credits ledger.
    """
    from src.billing import metering
    from src.db.connection import get_tenant_connection
    from src.db import observability as observability_repo

    factor = metering.markup_for(user["org_id"])
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        result = observability_repo.email_trace(
            conn, limit=limit, offset=offset, sort_column=sort, sort_dir=dir,
            filter_q=q, provider=provider,
        )
    for row in result["rows"]:
        row["cost"] = _markup_cost(row.get("cost"), factor)
    return result


@app.get("/api/admin/observability/by-document")
def admin_observability_by_document(
    user: dict = Depends(require_role("admin")),
) -> dict:
    """Per-document token + cost rollup for comprehended Google Drive files —
    which documents are the most token- and credit-intensive (most expensive
    first). Empty until Drive comprehension is enabled and has run. Per-document
    cost is marked up to the customer-facing figure (1 credit = $1), like the
    Usage panel."""
    from src.billing import metering
    from src.db.connection import get_tenant_connection
    from src.db import observability as observability_repo

    factor = metering.markup_for(user["org_id"])
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        result = observability_repo.cost_by_document(conn)
    for row in result["rows"]:
        row["cost"] = _markup_cost(row.get("cost"), factor)
    return result


@app.get("/api/admin/observability/questions")
def admin_observability_questions(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_role("admin")),
) -> dict:
    """Egress · Ask: per-question token usage + cost for the caller's workspace,
    newest first. Question text lives in the tenant brain; token/cost live in the
    control-plane usage ledger (request_kind='qa'), joined here by the question id
    stamped into each usage event's meta. Cost is marked up to the customer-facing
    figure (1 credit = $1), like the rest of the observability/usage surfaces."""
    from datetime import timezone
    from decimal import Decimal

    from src import config
    from src.billing import metering
    from src.db.connection import get_tenant_connection
    from src.db import questions as questions_repo

    factor = metering.markup_for(user["org_id"])
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        page = questions_repo.list_questions_page(conn, limit=limit, offset=offset)
        qtimes = questions_repo.all_question_times(conn)
    events = metering.qa_usage_events(user["org_id"])

    def _epoch(dt):
        if dt is None:
            return None
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()

    # Attribute each Q&A usage event to a question: by the stamped question_id
    # when present (new questions), else by nearest timestamp (questions asked
    # before per-question stamping existed). Cost lives in the control DB and
    # can't be SQL-joined to the tenant `questions` table, so we match here.
    by_qid: dict[int, dict] = {}
    unclaimed: list[dict] = []
    for e in events:
        qid = e["question_id"]
        if qid is None:
            unclaimed.append(e)
            continue
        a = by_qid.setdefault(qid, {"calls": 0, "in": 0, "out": 0,
                                    "cost": Decimal(0), "model": None, "_mtok": -1})
        a["calls"] += 1
        a["in"] += e["prompt_tokens"]
        a["out"] += e["completion_tokens"]
        a["cost"] += Decimal(e["total_cost"])
        tok = e["prompt_tokens"] + e["completion_tokens"]
        if e["model"] and tok > a["_mtok"]:
            a["model"], a["_mtok"] = e["model"], tok

    _PROXIMITY_WINDOW = 600  # seconds; a question's synthesis lands within minutes
    ep = [_epoch(e["occurred_at"]) for e in unclaimed]
    used = [False] * len(unclaimed)
    for qid, created in qtimes:
        if qid in by_qid:
            continue
        ce = _epoch(created)
        if ce is None:
            continue
        best_i, best_d = None, None
        for i, e in enumerate(unclaimed):
            if used[i] or ep[i] is None:
                continue
            d = abs(ep[i] - ce)
            if d <= _PROXIMITY_WINDOW and (best_d is None or d < best_d):
                best_i, best_d = i, d
        if best_i is not None:
            used[best_i] = True
            e = unclaimed[best_i]
            tok = e["prompt_tokens"] + e["completion_tokens"]
            by_qid[qid] = {"calls": 1, "in": e["prompt_tokens"], "out": e["completion_tokens"],
                           "cost": Decimal(e["total_cost"]), "model": e["model"], "_mtok": tok}

    default_model = config.LLM_QA_MODEL or config.LLM_BASE_MODEL or None
    rows = []
    for q in page["rows"]:
        u = by_qid.get(int(q["id"]))
        rows.append({
            "id": q["id"],
            "question": q["question"],
            "created_at": q["created_at"],
            "prompt_tokens": u["in"] if u else None,
            "completion_tokens": u["out"] if u else None,
            "llm_calls": u["calls"] if u else None,
            # Always name a model: the one that ran, else the configured Q&A model.
            "model": (u["model"] if u and u["model"] else default_model),
            "cost": _markup_cost(str(u["cost"]), factor) if u else None,
        })
    return {
        "rows": rows,
        "total": page["total"],
        "limit": page["limit"],
        "offset": page["offset"],
        "currency": "USD",
    }


@app.get("/api/admin/observability/delivery")
def admin_observability_delivery(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_role("admin")),
) -> dict:
    """Egress · Delivery: the DeliveryAgent *sync* (agenda inference) cost per pool
    refresh, newest first, with the member it ran for. Document drafting/edit cost
    is a separate, not-yet-active kind (``delivery_draft``) and isn't returned
    here. Cost is marked up to the customer-facing figure (1 credit = $1)."""
    from src import config
    from src.billing import metering
    from src.db.connection import get_tenant_connection
    from src.db import delivery_store

    factor = metering.markup_for(user["org_id"])
    default_model = config.LLM_QA_MODEL or config.LLM_BASE_MODEL or None
    # The tenant's pool timestamps let us reclaim delivery syncs that were metered
    # before org attribution was wired (org_id NULL) — see delivery_sync_events.
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        claim_times = delivery_store.pool_times(conn)
    result = metering.delivery_sync_events(
        user["org_id"], claim_times=claim_times, limit=limit, offset=offset,
    )
    for row in result["rows"]:
        row["cost"] = _markup_cost(row.get("cost"), factor)
        if not row.get("model"):
            row["model"] = default_model
    return result


@app.get("/api/admin/observability/relationship-trace")
def admin_relationship_trace(
    captured_event_id: int = Query(..., ge=1),
    user: dict = Depends(require_role("admin")),
) -> dict:
    """The comprehend debug trace for one email: the English text the agents saw,
    the entities that entered the fan-out, the structural edges, and per subject
    the RelationshipAgent's candidates / raw output / drops / normalization /
    final. For debugging relationship extraction in the Observability tab."""
    from src.db.connection import get_tenant_connection
    from src.db import observability as observability_repo

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        trace = observability_repo.relationship_trace(conn, captured_event_id)
    if trace is None:
        raise HTTPException(404, "No comprehend trace for this email.")
    return {"captured_event_id": captured_event_id, "trace": trace}


# --- comprehend "Diligence" settings (per tenant) ---------------------------

class ComprehendSettingsBody(BaseModel):
    relationship_diligence: str | None = None
    context_agents: dict | None = None
    context_max_neighbors: int | None = None
    # Whether the comprehend agents run over Google Drive documents (entities +
    # graph). Off by default — gates metered LLM work; chunks/retrieval are
    # unaffected.
    drive_comprehend_enabled: bool | None = None


def _read_comprehend_settings(db_name: str) -> dict:
    from src.db.connection import get_tenant_connection
    from src.ingestion.comprehend import settings_store

    with get_tenant_connection(db_name) as conn:
        return settings_store.get_settings(conn)


def _write_comprehend_settings(db_name: str, body: "ComprehendSettingsBody", actor: str) -> dict:
    from src.db.connection import get_tenant_connection
    from src.ingestion.comprehend import settings_store

    with get_tenant_connection(db_name) as conn:
        try:
            return settings_store.update_settings(
                conn,
                relationship_diligence=body.relationship_diligence,
                context_agents=body.context_agents,
                context_max_neighbors=body.context_max_neighbors,
                drive_comprehend_enabled=body.drive_comprehend_enabled,
                actor=actor,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.get("/api/admin/comprehend-settings")
def admin_get_comprehend_settings(user: dict = Depends(require_role("admin"))) -> dict:
    """The comprehend Diligence config (relationship pairing mode + per-agent
    brain-context toggles) for the caller's workspace."""
    return _read_comprehend_settings(_tenant_db_for(user["org_id"]))


@app.put("/api/admin/comprehend-settings")
def admin_put_comprehend_settings(
    body: ComprehendSettingsBody, user: dict = Depends(require_role("admin"))
) -> dict:
    return _write_comprehend_settings(
        _tenant_db_for(user["org_id"]), body, user.get("email") or "admin"
    )


@app.get("/api/platform/tenants/{slug}/comprehend-settings")
def platform_get_comprehend_settings(
    slug: str, _owner: dict = Depends(require_owner)
) -> dict:
    """Operator view of a tenant's comprehend Diligence config."""
    return _read_comprehend_settings(provision.tenant_db_name(slug.strip()))


@app.put("/api/platform/tenants/{slug}/comprehend-settings")
def platform_put_comprehend_settings(
    slug: str, body: ComprehendSettingsBody, _owner: dict = Depends(require_owner)
) -> dict:
    return _write_comprehend_settings(
        provision.tenant_db_name(slug.strip()), body, _owner.get("email") or "owner"
    )


class MarkupBody(BaseModel):
    # The per-workspace customer markup (raw cost × factor = what the customer
    # pays; 1 credit = $1). null clears the override back to the global default.
    factor: float | None = None


@app.get("/api/platform/tenants/{slug}/markup")
def platform_get_markup(slug: str, _owner: dict = Depends(require_owner)) -> dict:
    """This workspace's customer markup: its override (or null = global default),
    the global default, and whether it has funded credits (so the UI can warn
    that changing the factor re-prices an existing balance)."""
    from src.billing import metering
    from src.db.connection import get_control_connection

    org_id = service.org_id_for_slug(slug.strip())
    if org_id is None:
        raise HTTPException(404, f"No organization with slug {slug!r}.")
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT markup_factor FROM organizations WHERE id = %s;", (org_id,))
        row = cur.fetchone()
    override = float(row[0]) if row and row[0] is not None else None
    funded = metering.balance(org_id)["credits_granted"] > 0
    return {
        "slug": slug.strip(),
        "factor": override,
        "effective": override if override is not None else float(metering.CUSTOMER_MARKUP),
        "default": float(metering.CUSTOMER_MARKUP),
        "min": float(metering.MIN_MARKUP),
        "max": float(metering.MAX_MARKUP),
        "has_funded_credits": funded,
    }


@app.put("/api/platform/tenants/{slug}/markup")
def platform_set_markup(
    slug: str, body: MarkupBody, _owner: dict = Depends(require_owner)
) -> dict:
    """Set (or clear, with null) a workspace's customer markup. Operator-only.

    Only the customer-facing multiplier changes — internal raw storage (spend,
    grants, the credit ceiling) is untouched — so this re-prices what this
    workspace SEES, including historical figures. Audited."""
    from src.billing import metering

    org_id = service.org_id_for_slug(slug.strip())
    if org_id is None:
        raise HTTPException(404, f"No organization with slug {slug!r}.")
    try:
        effective = metering.set_markup(org_id, body.factor)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    audit.record_event(
        "platform_set_markup",
        org_id=org_id,
        actor=_owner.get("email") or "owner",
        detail={"factor": body.factor},
    )
    return {
        "slug": slug.strip(),
        "factor": body.factor,
        "effective": float(effective),
        "default": float(metering.CUSTOMER_MARKUP),
    }


@app.get("/api/admin/ingestion")
def admin_ingestion(user: dict = Depends(require_role("admin"))) -> dict:
    """Operational health of the mail sync: when it last ran and how it went.

    Admin-facing operability — so a stalled or failing sync surfaces here
    instead of being noticed by accident. Counts only (no content); ``error``
    carries the failure message from the most recent run, when there is one.
    """
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT mailbox, last_synced_at FROM capture_cursors "
            "ORDER BY last_synced_at DESC NULLS LAST LIMIT 1;"
        )
        row = cur.fetchone()
        last_sync = (
            {
                "mailbox": row[0],
                "at": row[1].isoformat() if row[1] else None,
            }
            if row
            else None
        )

        cur.execute(
            "SELECT mailbox, started_at, finished_at, fetched, included, "
            "excluded, duplicates, removed, error "
            "FROM capture_runs ORDER BY started_at DESC LIMIT 1;"
        )
        r = cur.fetchone()
        last_run = (
            {
                "mailbox": r[0],
                "started_at": r[1].isoformat() if r[1] else None,
                "finished_at": r[2].isoformat() if r[2] else None,
                "fetched": r[3],
                "included": r[4],
                "excluded": r[5],
                "duplicates": r[6],
                "removed": r[7],
                "error": r[8],
                # A run is healthy once it finished with no error recorded.
                "ok": r[8] is None and r[2] is not None,
            }
            if r
            else None
        )

        # Today's running tally across all of today's runs (most syncs fetch a
        # handful at most, so the daily total is the useful number).
        cur.execute(
            "SELECT COALESCE(SUM(fetched),0), COALESCE(SUM(included),0), "
            "COALESCE(SUM(excluded),0), COALESCE(SUM(duplicates),0), "
            "COALESCE(SUM(removed),0) "
            "FROM capture_runs WHERE started_at::date = CURRENT_DATE;"
        )
        t = cur.fetchone()
        today = {
            "fetched": t[0], "included": t[1], "excluded": t[2],
            "duplicates": t[3], "removed": t[4],
        }

        # Per-day totals for the last 30 days (drives the daily line chart).
        cur.execute(
            "SELECT started_at::date AS d, COALESCE(SUM(fetched),0), "
            "COALESCE(SUM(included),0), COALESCE(SUM(excluded),0), "
            "COALESCE(SUM(duplicates),0), COALESCE(SUM(removed),0) "
            "FROM capture_runs "
            "WHERE started_at >= CURRENT_DATE - INTERVAL '29 days' "
            "GROUP BY d ORDER BY d;"
        )
        daily = [
            {
                "date": dr[0].isoformat(),
                "fetched": dr[1], "included": dr[2], "excluded": dr[3],
                "duplicates": dr[4], "removed": dr[5],
            }
            for dr in cur.fetchall()
        ]

    return {
        "org": user["org"], "last_sync": last_sync, "last_run": last_run,
        "today": today, "daily": daily,
    }


@app.get("/api/admin/connections")
def admin_connections(user: dict = Depends(require_role("admin"))) -> dict:
    """Whether this workspace is connected to an AI assistant (Claude / ChatGPT)
    over MCP — counting personal access tokens and OAuth grants, with the most
    recent activity. Read from the control plane (where tokens live)."""
    from src.db.connection import get_control_connection

    org_id = user["org_id"]
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), max(last_used_at) FROM mcp_tokens "
            "WHERE org_id = %s AND revoked_at IS NULL "
            "AND (expires_at IS NULL OR expires_at > now());",
            (org_id,),
        )
        m = cur.fetchone()
        cur.execute(
            "SELECT count(DISTINCT grant_id), max(created_at) FROM oauth_tokens "
            "WHERE org_id = %s AND revoked_at IS NULL "
            "AND (expires_at IS NULL OR expires_at > now());",
            (org_id,),
        )
        o = cur.fetchone()
    mcp_tokens_n = int(m[0] or 0)
    oauth_grants_n = int(o[0] or 0)
    times = [x for x in (m[1], o[1]) if x is not None]
    return {
        "connected": (mcp_tokens_n + oauth_grants_n) > 0,
        "mcp_tokens": mcp_tokens_n,
        "oauth_grants": oauth_grants_n,
        "last_activity": max(times).isoformat() if times else None,
    }


# --- capture sources (which mailboxes a tenant pulls) + manual backfill -----

# Backfill window guardrails (customer-facing defaults). A backfill is a live
# Graph pull, so the cap keeps a single click from fetching an unbounded folder.
_BACKFILL_DEFAULT_DAYS = 90
_BACKFILL_DEFAULT_MAX = 200
_BACKFILL_MAX_CEILING = 2000


class AddSourceBody(BaseModel):
    mailbox: str


class BackfillItem(BaseModel):
    # One mailbox to backfill, with its OWN window — each mailbox can have a
    # different "since" and a different cap.
    source_id: int
    # ISO date/datetime; defaults to _BACKFILL_DEFAULT_DAYS ago when omitted.
    since: str | None = None
    # Newest-first cap for this mailbox; defaults to _BACKFILL_DEFAULT_MAX.
    max_count: int | None = None


class BackfillBody(BaseModel):
    # The mailboxes to backfill — one or many, each with its own window, so an
    # admin can sweep several mailboxes (with different settings) in one click.
    items: list[BackfillItem]


@app.get("/api/admin/sources")
def admin_list_sources(user: dict = Depends(require_role("admin"))) -> dict:
    """The mailboxes this workspace pulls mail from (the Capture editor loads this)."""
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        sources = sources_store.list_sources(conn)
        stats = sources_store.source_stats(conn)
    # Merge per-mailbox capture stats onto each source so the Sources network can
    # show captured-total / oldest / last per specific account. Mailboxes with no
    # captures default to 0 / null / null.
    for s in sources:
        st = stats.get((s.get("mailbox") or "").lower(), {})
        s["captured"] = st.get("captured", 0)
        s["oldest_email"] = st.get("oldest_email")
        s["last_capture"] = st.get("last_capture")
    return {"org": user["org"], "sources": sources}


@app.post("/api/admin/sources")
def admin_add_source(
    body: AddSourceBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Register (or re-enable) a mailbox to pull from. Idempotent on the mailbox.

    The sync pulls from all of the mailbox's folders (minus junk/deleted/drafts),
    so there is nothing to choose per folder.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    mailbox = (body.mailbox or "").strip()
    if not mailbox:
        raise HTTPException(400, "mailbox is required.")
    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        try:
            sources_store.add_source(conn, mailbox, actor=actor)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        sources = sources_store.list_sources(conn)
    return {"org": user["org"], "sources": sources}


class ImapSourceBody(BaseModel):
    # A generic IMAP mailbox (for customers not on Microsoft). The app password
    # is sent once over HTTPS and stored encrypted; it is never returned.
    host: str
    username: str
    password: str
    port: int = 993
    use_ssl: bool = True


def _imap_config_from_body(body: ImapSourceBody):
    """Validate the form and build an ImapConfig (raises 400 on missing fields)."""
    from src.ingestion.capture.imap_client import ImapConfig

    host = (body.host or "").strip()
    username = (body.username or "").strip()
    if not host or not username:
        raise HTTPException(400, "IMAP host and username are required.")
    if not body.password:
        raise HTTPException(400, "IMAP app password is required.")
    return ImapConfig(
        host=host,
        username=username,
        password=body.password,
        port=body.port or 993,
        use_ssl=body.use_ssl,
    )


@app.post("/api/admin/sources/imap/test")
def admin_test_imap_source(
    body: ImapSourceBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Try the IMAP credentials live, WITHOUT saving — the "test connection" button.

    Connects, logs in, and opens the inbox, returning the same verdict shape the
    Graph access check uses ("readable" / "auth_failed" / "error") so the admin
    can confirm the host + app password work before registering the source.
    """
    from src.ingestion.capture.imap_client import ImapFetcher

    cfg = _imap_config_from_body(body)
    status, detail = ImapFetcher(cfg).probe()
    return {"status": status, "detail": detail}


@app.post("/api/admin/sources/imap")
def admin_add_imap_source(
    body: ImapSourceBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Register (or update) a generic IMAP mailbox to pull from.

    Idempotent on the IMAP username (the mailbox identity): re-submitting updates
    the host/port/SSL and password and re-enables it. The app password is
    encrypted at rest via secret_box before it touches the database.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    cfg = _imap_config_from_body(body)
    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        try:
            sources_store.add_imap_source(
                conn,
                host=cfg.host,
                username=cfg.username,
                password=cfg.password,
                port=cfg.port,
                use_ssl=cfg.use_ssl,
                actor=actor,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        sources = sources_store.list_sources(conn)
    return {"org": user["org"], "sources": sources}


class GdriveSourceBody(BaseModel):
    # The Drive folder (or Shared Drive) link the admin pastes, e.g.
    # https://drive.google.com/drive/folders/<id>. A bare id is also accepted.
    url: str


@app.get("/api/admin/sources/gdrive/share-target")
def admin_gdrive_share_target(user: dict = Depends(require_role("admin"))) -> dict:
    """The service-account email an admin shares a Drive folder with, plus whether
    the server has the shared service account configured at all. The Connect modal
    shows this as step 1 (grant access) before the admin pastes a folder link."""
    from src.ingestion.capture import gdrive_client

    return {
        "email": gdrive_client.share_target(),
        "configured": gdrive_client.is_configured(),
    }


@app.post("/api/admin/sources/gdrive/test")
def admin_test_gdrive_source(
    body: GdriveSourceBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Live check, WITHOUT saving — the Drive "test connection" button.

    Parses the folder id from the pasted link and asks Google (as our shared
    service account) whether we can read it, returning a uniform verdict
    ("readable" / "auth_failed" / "not_configured" / "error") so the admin can
    confirm they've shared the folder before connecting it.
    """
    from src.ingestion.capture import gdrive_client

    folder_id = gdrive_client.parse_folder_id(body.url)
    if not folder_id:
        return {
            "status": "error",
            "detail": "That doesn't look like a Google Drive folder link. Paste the "
            "folder's share link (…/drive/folders/…).",
        }
    status, detail = gdrive_client.probe(folder_id)
    return {"status": status, "detail": detail, "folder_id": folder_id}


@app.post("/api/admin/sources/gdrive")
def admin_add_gdrive_source(
    body: GdriveSourceBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Connect a Google Drive folder: parse the link, verify we can read it (via the
    shared service account), then store it. Rejects the add if we can't access the
    folder yet — the admin must share it with our service account first.

    v0 is connect-only: this records WHICH folder to read; ingesting its files is a
    later phase, so the scheduler skips gdrive rows until that connector ships.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import gdrive_client, sources_store

    folder_id = gdrive_client.parse_folder_id(body.url)
    if not folder_id:
        raise HTTPException(400, "Paste a Google Drive folder link (…/drive/folders/…).")
    status, detail = gdrive_client.probe(folder_id)
    if status != "readable":
        # 400 with the probe's message (e.g. the "share it with us" hint) so the UI
        # can tell the admin exactly what to fix.
        raise HTTPException(400, detail)

    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        try:
            sources_store.add_gdrive_source(
                conn, folder_id=folder_id, folder_name=detail, actor=actor
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        sources = sources_store.list_sources(conn)
    return {"org": user["org"], "sources": sources}


class SourceEnabledBody(BaseModel):
    enabled: bool


@app.patch("/api/admin/sources/{source_id}")
def admin_toggle_source(
    source_id: int,
    body: SourceEnabledBody,
    user: dict = Depends(require_role("admin")),
) -> dict:
    """Enable or disable one mail source without removing it."""
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        if not sources_store.set_enabled(conn, source_id, body.enabled):
            raise HTTPException(404, "No such mail source.")
        sources = sources_store.list_sources(conn)
    return {"org": user["org"], "sources": sources}


@app.delete("/api/admin/sources/{source_id}")
def admin_remove_source(
    source_id: int, user: dict = Depends(require_role("admin"))
) -> dict:
    """Stop pulling from a mailbox. Leaves its cursor and captured events intact."""
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        if not sources_store.remove_source(conn, source_id):
            raise HTTPException(404, "No such mail source.")
        sources = sources_store.list_sources(conn)
    return {"org": user["org"], "sources": sources}


@app.delete("/api/admin/workspace")
def admin_delete_workspace(
    confirm: str = "",
    user: dict = Depends(require_role("admin")),
) -> Response:
    """Self-service erasure of the admin's OWN workspace: drops the tenant DB and
    wipes personal control-plane data (financial tombstone kept). Irreversible, so
    the admin must type their workspace slug back in the ``confirm`` query param
    (off the request body so it survives DELETE). On success the session cookie is
    cleared — the org and its members no longer exist."""
    slug = (user.get("org") or "").strip()
    if not slug:
        raise HTTPException(400, "No workspace bound to this session.")
    if (confirm or "").strip() != slug:
        raise HTTPException(400, "Confirmation does not match the workspace slug.")
    try:
        result = provision.erase_organization(
            slug, actor=user.get("email") or "admin"
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    resp = JSONResponse(result)
    resp.delete_cookie(sessions.COOKIE_NAME, path="/")
    return resp


@app.get("/api/admin/sources/access")
def admin_sources_access(user: dict = Depends(require_role("admin"))) -> dict:
    """Live check: can the connector actually read each enabled mailbox right now?

    Asks Microsoft once per enabled mailbox. A "blocked" verdict means the mailbox
    is in our pull list but NOT in the customer's Exchange access policy, so the
    sync gets nothing for it until the access-policy command is re-run to include
    it. This is the in-sync flag for the Mail sources panel.

    ``connector_configured`` is False when no connector credentials are set in the
    environment — then we can't check, and the panel says so rather than lying.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        mailboxes = sources_store.enabled_mailboxes(conn)

    if not mailboxes:
        return {"org": user["org"], "connector_configured": True, "checked": []}

    from src.ingestion.capture.graph_client import GraphMailClient

    try:
        client = GraphMailClient()  # one client (and token) for all mailboxes
    except RuntimeError as exc:
        return {
            "org": user["org"],
            "connector_configured": False,
            "detail": str(exc),
            "checked": [],
        }

    checked = [
        {"mailbox": mbx, **dict(zip(("status", "detail"), client.probe_mailbox(mbx)))}
        for mbx in mailboxes
    ]
    return {"org": user["org"], "connector_configured": True, "checked": checked}


class AccessPolicyCommandBody(BaseModel):
    scope: str  # mail-enabled security group address (created if missing)


@app.post("/api/admin/access-policy-command")
def admin_access_policy_command(
    body: AccessPolicyCommandBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """The Exchange Online command that grants the connector Mail.Read to exactly
    the mailboxes this admin enabled: create the scope group if missing, add those
    mailboxes to it, then bind a RestrictAccess policy. The admin runs it (or hands
    it to their Exchange admin) — we generate it, we never touch their tenant.

    This is the single home for mailbox access. The mailbox list IS the admin's
    onboarding selection, and the connector app id is shared server infra
    (GRAPH_CLIENT_ID), so neither is re-typed anywhere. The scope group address is
    the only value the admin names. ``connector_configured`` is False when the
    server has no connector app id set — the command then carries a clearly fake
    placeholder so it can't be pasted as-is by mistake.

    The generated block mirrors backend/scripts/application-access-policy.ps1.
    """
    import os
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store

    scope = (body.scope or "").strip()
    if not scope:
        raise HTTPException(400, "Enter the scope group address first.")

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        mailboxes = sources_store.enabled_mailboxes(conn)
    if not mailboxes:
        raise HTTPException(
            400,
            "Add and enable at least one mailbox first — the access policy "
            "follows your mailbox list.",
        )

    connector_id = os.environ.get("GRAPH_CLIENT_ID", "").strip()
    result = build_access_policy_command(
        connector_id or "<CONNECTOR-APP-ID>", scope, mailboxes
    )
    return {
        **result,
        "mailboxes": mailboxes,
        "connector_configured": bool(connector_id),
    }


@app.get("/api/admin/mail-consent-url")
def admin_mail_consent_url(_user: dict = Depends(require_role("admin"))) -> dict:
    """The one-time admin-consent link that grants Indigo Iota's connector the
    right to read mail in this customer's tenant.

    It is the SAME link for every customer (shared connector app id +
    ``/organizations`` authority), so the admin can hand it to whoever runs
    their Microsoft 365. Granting it is the prerequisite for the access policy
    below — that scopes the now-granted access down to the chosen mailboxes.
    """
    connector_id = os.environ.get("GRAPH_CLIENT_ID", "").strip()
    redirect = APP_BASE_URL.rstrip("/") + "/"
    url = (
        oidc.build_admin_consent_url(
            "organizations", connector_id, redirect, state="connector"
        )
        if connector_id
        else ""
    )
    return {"url": url, "configured": bool(connector_id)}


def _resolve_backfill_window(
    since_raw: str | None, max_raw: int | None
) -> tuple["datetime", int]:
    """Turn one mailbox's raw 'since'/'max' into a clamped (datetime, int).

    Missing 'since' defaults to _BACKFILL_DEFAULT_DAYS ago; missing max defaults
    to _BACKFILL_DEFAULT_MAX and is capped at _BACKFILL_MAX_CEILING. Raises
    HTTPException(400) on a bad value so the whole run fails before anything is
    pulled.
    """
    from datetime import datetime, timedelta, timezone

    max_count = max_raw or _BACKFILL_DEFAULT_MAX
    if max_count <= 0:
        raise HTTPException(400, "Max emails must be greater than 0.")
    max_count = min(max_count, _BACKFILL_MAX_CEILING)

    if since_raw:
        try:
            since = datetime.fromisoformat(since_raw)
        except ValueError:
            raise HTTPException(400, "Since must be an ISO date (YYYY-MM-DD).")
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=_BACKFILL_DEFAULT_DAYS)
    return since, max_count


@app.post("/api/admin/backfill")
def admin_backfill(
    body: BackfillBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Pull a bounded window of historical mail for one or more registered mailboxes.

    A live fetch (needs the source's credentials), across ALL of each mailbox's
    folders (minus junk/deleted/drafts, same as the live sync). Works for both
    providers: a Graph source is pulled with the tenant's app credentials, an IMAP
    source with its stored host/username/password. Each mailbox carries its OWN
    window: its own 'since' date and its own newest-first cap (shared across that
    mailbox's folders). Runs synchronously through the same scope gate and dedupes
    against already-captured events, but does NOT move the sync cursor. Every id
    must already be a registered source.
    """
    from datetime import timezone
    from imapclient.exceptions import IMAPClientError

    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import mail, sources_store
    from src.ingestion.triage import scope_store

    if not body.items:
        raise HTTPException(400, "Select at least one mailbox to backfill.")

    # De-dupe by source id, keeping the admin's order and first-seen window.
    seen: set[int] = set()
    items = [
        it for it in body.items if not (it.source_id in seen or seen.add(it.source_id))
    ]

    db_name = _tenant_db_for(user["org_id"])
    results: list[dict] = []
    totals = {"fetched": 0, "included": 0, "excluded": 0, "duplicates": 0, "removed": 0}

    from src.billing import metering as _metering
    _org_tok = _metering.set_current_org(user["org_id"])
    _usr_tok = _metering.set_current_user(_session_user_id(user))
    with get_tenant_connection(db_name) as conn:
        # Onboarding gate: backfill is the brain build-up, and it runs every
        # message through this tenant's scope policy. Until an admin has signed
        # off on that policy, we refuse — pulling mail through an unreviewed
        # scope gate is exactly what the guided onboarding flow exists to prevent.
        if not scope_store.is_approved(conn):
            raise HTTPException(
                409,
                "Scope policy not approved yet. Review and approve the triage "
                "scope before running a backfill.",
            )

        # Validate every id AND its window up front so a bad input fails fast,
        # before any mail is pulled. Carry each source (with its provider) along.
        planned: list[tuple[dict, "datetime", int]] = []
        for it in items:
            source = sources_store.get_source_by_id(conn, it.source_id)
            if not source:
                raise HTTPException(
                    400, f"No such registered source (id {it.source_id})."
                )
            since, max_count = _resolve_backfill_window(it.since, it.max_count)
            planned.append((source, since, max_count))

        from src.ingestion.capture.graph_client import GraphMailClient

        graph_client = None  # built lazily, shared across all Graph sources
        try:
            for source, since, max_count in planned:
                mailbox = source["mailbox"]
                # Pick the connector by provider; expose a uniform
                # ``(folders, pull(folder_id, remaining))`` so the budget loop
                # below is identical for both.
                if source["provider"] == "imap":
                    from src.ingestion.capture.imap_client import (
                        ImapConfig,
                        ImapFetcher,
                    )

                    cfg = sources_store.get_imap_config(conn, source["id"])
                    if not cfg:
                        raise HTTPException(
                            400,
                            f"IMAP source {mailbox} is missing its connection "
                            f"details.",
                        )
                    fetcher = ImapFetcher(ImapConfig(**cfg))
                    folders = fetcher.list_sync_folders()

                    def pull(folder_id, remaining, _f=fetcher, _s=since):
                        return _f.fetch_window(_s, remaining, folder_id)
                else:
                    if graph_client is None:
                        graph_client = GraphMailClient()  # one token for all Graph
                    folders = graph_client.list_sync_folders(mailbox)

                    def pull(folder_id, remaining, _c=graph_client, _m=mailbox, _s=since):
                        return _c.fetch_window(_m, _s, remaining, folder_id)

                # max_count is the admin's budget for the WHOLE mailbox. Gather the
                # newest max_count from each folder as candidates, then keep the
                # newest max_count OVERALL — so inbox + outbox are merged by
                # recency under the one cap the admin set. This fixes the old
                # shared-in-order budget (a large Inbox starved Sent) without
                # multiplying the total by the folder count.
                candidates: list = []
                for f in folders:
                    candidates.extend(pull(f["id"], max_count))

                def _recency(ev) -> float:
                    dt = ev.occurred_at
                    if dt is None:
                        return float("-inf")
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    return dt.timestamp()

                candidates.sort(key=_recency, reverse=True)
                events = candidates[:max_count]
                summary = mail.backfill_mailbox(conn, mailbox, events)
                r = summary.as_dict()
                for k in totals:
                    totals[k] += r[k]
                results.append(
                    {
                        "mailbox": mailbox,
                        "folders": len(folders),
                        "since": since.isoformat(),
                        "max_count": max_count,
                        "result": r,
                    }
                )
        except (RuntimeError, OSError, IMAPClientError) as exc:
            # Missing/invalid credentials or a mail-server connection failure
            # surface as a 400, not a 500.
            raise HTTPException(400, str(exc))

    _metering.reset_current_org(_org_tok)
    _metering.reset_current_user(_usr_tok)
    return {
        "org": user["org"],
        "results": results,
        "totals": totals,
    }


# A workspace is "running low" once it has burned this fraction of what it
# funded — the amber warning before the hard stop at zero.
_LOW_BALANCE_FRACTION = 0.85


@app.get("/api/admin/credits")
def admin_credits(user: dict = Depends(require_role("admin"))) -> dict:
    """What the workspace funded, spent, and has left — plus run-out flags.

    The only ceiling is the credits the workspace bought: balance = granted −
    spent, and when it hits zero every LLM call is paused. Every monetary figure
    is marked up to customer dollars (1 credit = $1). ``estimate`` turns the
    remaining balance into ≈ how many more emails / files it covers.
    """
    from src.billing import metering

    factor = metering.markup_for(user["org_id"])
    b = metering.balance(user["org_id"])
    mk = lambda a: metering.to_customer_facing(a, factor)  # noqa: E731

    granted, spent, bal = b["credits_granted"], b["credits_spent"], b["balance"]
    out_of_credits = bal <= 0
    fraction_used = float(spent / granted) if granted > 0 else (1.0 if spent > 0 else 0.0)
    low_balance = (not out_of_credits) and fraction_used >= _LOW_BALANCE_FRACTION

    try:
        estimate = metering.capacity_for(mk(bal if bal > 0 else 0), factor)
    except Exception:
        estimate = {"emails": None, "files": None}

    # Customer-facing cost of processing one average email. Lets the UI quote a
    # backfill up front (emails × this) before it runs. None if the price book
    # is empty. Already marked up at this workspace's factor — do NOT apply mk().
    try:
        cost_per_email = _money(metering.customer_cost_per_email(factor))
    except Exception:
        cost_per_email = None

    return {
        "org": user["org"],
        "credits_granted": _money(mk(granted)),
        "credits_spent": _money(mk(spent)),
        "balance": _money(mk(bal)),
        "fraction_used": fraction_used,
        "out_of_credits": out_of_credits,
        "low_balance": low_balance,
        "estimate": estimate,
        "cost_per_email": cost_per_email,
    }


@app.get("/api/admin/credits/history")
def admin_credits_history(
    granularity: str = "day", user: dict = Depends(require_role("admin"))
) -> dict:
    """Time series of credit spend per period and the remaining balance after it.

    Drives the spend/remaining chart. ``granularity`` is 'day' or 'week'. Both
    ``spent`` and ``remaining`` are marked up to customer dollars.
    """
    from src.billing import metering

    if granularity not in ("day", "week"):
        raise HTTPException(400, "granularity must be 'day' or 'week'.")
    factor = metering.markup_for(user["org_id"])
    mk = lambda a: metering.to_customer_facing(a, factor)  # noqa: E731
    series = metering.credit_timeseries(user["org_id"], granularity=granularity)
    return {
        "org": user["org"],
        "granularity": granularity,
        "series": [
            {
                "period_start": p["period_start"].isoformat(),
                "spent": _money(mk(p["spent"])),
                "remaining": _money(mk(p["remaining"])),
            }
            for p in series
        ],
    }


class AddCreditsBody(BaseModel):
    # Dollars to add to this workspace (customer-facing; 1 credit = $1).
    amount: float


@app.post("/api/admin/credits/add")
def admin_add_credits(
    body: AddCreditsBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Top up this workspace's credits.

    Records a timestamped purchase in the credit ledger (``credit_entries``),
    which is what invoicing reads. The admin enters whole US dollars; we divide
    by the markup to store raw units and echo the new balance back marked up.
    Raises the workspace's spending ceiling by exactly this amount — the only
    ceiling is what's been funded.
    """
    from decimal import Decimal

    from src.billing import metering

    if body.amount is None or body.amount <= 0:
        raise HTTPException(400, "amount must be greater than 0.")
    factor = metering.markup_for(user["org_id"])
    raw_amount = metering.from_customer_facing(Decimal(str(body.amount)), factor)
    metering.grant_credits(
        user["org_id"],
        raw_amount,
        kind="grant",
        actor=user.get("email") or user.get("org"),
        note="admin top-up",
    )
    b = metering.balance(user["org_id"])
    mk = lambda a: metering.to_customer_facing(a, factor)  # noqa: E731
    return {
        "org": user["org"],
        "credits_granted": _money(mk(b["credits_granted"])),
        "credits_spent": _money(mk(b["credits_spent"])),
        "balance": _money(mk(b["balance"])),
    }


def _since_for_days(days: int):
    """Clamp a ``days`` query param and turn it into a UTC cutoff instant."""
    from datetime import datetime, timedelta, timezone

    days = max(1, min(int(days), 366))
    return days, datetime.now(timezone.utc) - timedelta(days=days)


@app.get("/api/admin/usage/by-user")
def admin_usage_by_user(
    days: int = 30, user: dict = Depends(require_role("admin"))
) -> dict:
    """Per-member LLM cost breakdown for this workspace over the last ``days``.

    Each member's interactive Q&A and the ingestion from any mailbox they own
    fold into one row; a shared mailbox nobody signs in as shows on its own,
    labelled by address. All cost figures are marked up to customer dollars
    (1 credit = $1).
    """
    from decimal import Decimal

    from src.billing import metering

    _, since = _since_for_days(days)
    factor = metering.markup_for(user["org_id"])
    rows = metering.usage_by_user(user["org_id"], since=since)
    mk = lambda a: metering.to_customer_facing(a, factor)  # noqa: E731
    return {
        "org": user["org"],
        "rows": [
            {
                **r,
                "total_cost": _money(mk(Decimal(r["total_cost"]))),
                "ingestion_cost": _money(mk(Decimal(r["ingestion_cost"]))),
                "qa_cost": _money(mk(Decimal(r["qa_cost"]))),
            }
            for r in rows
        ],
    }


@app.get("/api/admin/usage/timeseries")
def admin_usage_timeseries(
    days: int = 30, user: dict = Depends(require_role("admin"))
) -> dict:
    """Daily ingestion-vs-Q&A cost and tokens for this workspace.

    Drives the comparison chart. Costs are marked up to customer dollars; the
    frontend re-buckets these days into weeks for the week view.
    """
    from decimal import Decimal

    from src.billing import metering

    days, _ = _since_for_days(days)
    factor = metering.markup_for(user["org_id"])
    series = metering.usage_timeseries(user["org_id"], days=days)
    mk = lambda a: metering.to_customer_facing(a, factor)  # noqa: E731
    return {
        "org": user["org"],
        "days": days,
        "series": [
            {
                "period_start": p["period_start"],
                "ingestion_cost": _money(mk(Decimal(p["ingestion_cost"]))),
                "qa_cost": _money(mk(Decimal(p["qa_cost"]))),
                "ingestion_tokens": p["ingestion_tokens"],
                "qa_tokens": p["qa_tokens"],
            }
            for p in series
        ],
    }


@app.get("/api/platform/usage")
def platform_usage(days: int = 30, _owner: dict = Depends(require_owner)) -> dict:
    """Platform-wide per-(org, member) LLM cost breakdown across all workspaces.

    Owner-only. Returns raw internal cost (not marked up) so the operator sees
    the actual spend, not the customer-facing marked-up figure.
    """
    from src.billing import metering

    _, since = _since_for_days(days)
    return {"days": days, "rows": metering.usage_by_org_and_user(since=since)}


@app.get("/api/platform/usage/timeseries")
def platform_usage_timeseries(
    days: int = 30, _owner: dict = Depends(require_owner)
) -> dict:
    """Daily ingestion-vs-Q&A cost and tokens across ALL workspaces (raw cost).

    Owner-only. Aggregates every org into one platform-wide series.
    """
    from src.billing import metering

    days, _ = _since_for_days(days)
    series = metering.usage_timeseries(None, days=days)
    return {
        "days": days,
        "series": [
            {
                "period_start": p["period_start"],
                "ingestion_cost": p["ingestion_cost"],
                "qa_cost": p["qa_cost"],
                "ingestion_tokens": p["ingestion_tokens"],
                "qa_tokens": p["qa_tokens"],
            }
            for p in series
        ],
    }


# --- scope definitions (admin-editable email classification) ----------------

def _tenant_db_for(org_id: int) -> str:
    """Resolve the caller org's active brain database name from the registry."""
    from src.db.connection import get_control_connection

    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT db_name FROM tenant_databases "
            "WHERE org_id = %s AND status = 'active' "
            "ORDER BY db_name LIMIT 1;",
            (org_id,),
        )
        row = cur.fetchone()
    if not row:
        raise HTTPException(404, "No active brain database for this organization.")
    return row[0]


def _brain_progress(conn) -> dict:
    """How far the brain build-up has actually gone for this tenant.

    ``emails_analyzed`` counts in-scope mail that was captured and stored;
    ``entities_mapped`` counts what comprehension extracted from it. The brain
    is "initialized" once BOTH the capture and comprehend steps have produced
    something — that's the bar for leaving onboarding, so an admin can't finish
    setup on an empty brain.
    """
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM captured_events WHERE source = 'email';")
        emails = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM entities;")
        entities = cur.fetchone()[0]
    return {
        "emails_analyzed": emails,
        "entities_mapped": entities,
        "brain_initialized": emails > 0 and entities > 0,
    }


class ScopeBucketEdit(BaseModel):
    anchors: list[str] | None = None


class ScopeUpdate(BaseModel):
    margin: float | None = None
    buckets: dict[str, ScopeBucketEdit] | None = None


@app.get("/api/admin/scope")
def admin_get_scope(user: dict = Depends(require_role("admin"))) -> dict:
    """This org's email-scope definitions (Admin Center editor loads this).

    The four buckets and which one includes are fixed policy; admins edit each
    bucket's example anchors and the security margin. The prose description is
    fixed explanatory copy and is not editable.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.triage import classify, scope_store

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        defs = scope_store.get_definitions(conn)
        approval = scope_store.get_approval(conn)
    return {
        "org": user["org"],
        "margin": defs["margin"],
        "include_bucket": classify.INCLUDE_BUCKET,
        "editable_buckets": list(classify.REQUIRED_BUCKETS),
        "buckets": defs["buckets"],
        "approval": approval,
    }


@app.post("/api/admin/scope/approve")
def admin_approve_scope(user: dict = Depends(require_role("admin"))) -> dict:
    """Sign off on this org's scope policy, which unpauses capture.

    Until this is called, both the scheduled sync and manual backfill stay
    paused for the tenant — we never pull mail through an unreviewed scope gate.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.triage import scope_store

    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        approval = scope_store.approve(conn, actor=actor)
    return {"org": user["org"], "approval": approval}


@app.get("/api/admin/onboarding")
def admin_onboarding(user: dict = Depends(require_role("admin"))) -> dict:
    """Where this workspace is in the guided onboarding flow.

    The Admin Center runs a once-per-tenant onboarding WIZARD and then switches
    to the steady-state DASHBOARD. ``onboarded`` is the switch: while false the
    UI renders the wizard; once an admin clicks Finish it renders the dashboard.
    The per-step flags report which gates are satisfied so the wizard can light
    up the right step and refuse to let a backfill (the brain build-up) run
    before the scope policy is reviewed and signed off.

    Steps:
        sources_connected   at least one mailbox registered AND enabled
        scope_approved      an admin has signed off on the triage scope policy
        ontology_defined    the node/edge vocabulary has at least one entity type
    """
    from src.db import ontology as ontology_repo
    from src.db import onboarding_store
    from src.db.connection import get_tenant_connection
    from src.ingestion.capture import sources_store
    from src.ingestion.triage import scope_store

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        sources = sources_store.list_sources(conn)
        sources_enabled = [s for s in sources if s.get("enabled")]
        approval = scope_store.get_approval(conn)
        ont = ontology_repo.load_ontology(conn)
        status = onboarding_store.get_status(conn)
        progress = _brain_progress(conn)

    return {
        "org": user["org"],
        "onboarded": status["onboarded"],
        "onboarded_at": status["onboarded_at"],
        "onboarded_by": status["onboarded_by"],
        "sources_connected": bool(sources_enabled),
        "sources_total": len(sources),
        "sources_enabled": len(sources_enabled),
        "scope_approved": approval["approved"],
        "scope_approved_at": approval["approved_at"],
        "scope_approved_by": approval["approved_by"],
        "ontology_defined": bool(ont.entity_types),
        "ontology_entity_types": len(ont.entity_types),
        "brain_initialized": progress["brain_initialized"],
        "emails_analyzed": progress["emails_analyzed"],
        "entities_mapped": progress["entities_mapped"],
        # Dev flag: tells the wizard to show a bypass button. Only true when
        # DEV_SKIP_BRAIN_CHECK is set in the environment (never in prod).
        "dev_skip_brain_check": bool(os.getenv("DEV_SKIP_BRAIN_CHECK")),
    }


@app.post("/api/admin/onboarding/complete")
def admin_complete_onboarding(user: dict = Depends(require_role("admin"))) -> dict:
    """Finish the once-per-tenant onboarding wizard.

    Stamps the completion so the Admin Center switches from the setup wizard to
    the steady-state dashboard. Idempotent — re-finishing keeps the first stamp.

    Guarded on a real-state bar: you can't leave onboarding until the brain is
    actually initialized — capture AND comprehend must have produced something
    (analyzed emails plus extracted entities). Stamping "done" on an empty brain
    would let an admin into the steady-state dashboard for a workspace that has
    never run, which is exactly what onboarding exists to prevent.
    """
    from src.db import onboarding_store
    from src.db.connection import get_tenant_connection

    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        progress = _brain_progress(conn)
        if not progress["brain_initialized"] and not os.getenv("DEV_SKIP_BRAIN_CHECK"):
            raise HTTPException(
                409,
                "The brain isn't built yet. Run a backfill so capture and "
                "comprehension have produced entities before finishing setup.",
            )
        status = onboarding_store.mark_onboarded(conn, actor=actor)
    return {"org": user["org"], "onboarding": status}


@app.post("/api/admin/onboarding/reopen")
def admin_reopen_onboarding(user: dict = Depends(require_role("admin"))) -> dict:
    """Re-run the onboarding wizard.

    Clears the completion stamp so the Admin Center drops back into the guided
    setup. Every underlying setting is unchanged — this only flips which view
    the admin sees, letting them walk the steps again.
    """
    from src.db import onboarding_store
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        status = onboarding_store.reopen(conn)
    return {"org": user["org"], "onboarding": status}


@app.put("/api/admin/scope")
def admin_update_scope(
    body: ScopeUpdate, user: dict = Depends(require_role("admin"))
) -> dict:
    """Update this org's scope definitions (margin and/or bucket anchors).

    Only ``anchors`` and ``margin`` are editable. A bucket's action
    (include/exclude) and its prose description are fixed and cannot be
    changed here.
    """
    from src.db.connection import get_tenant_connection
    from src.ingestion.triage import classify, scope_store

    if body.buckets:
        unknown = [b for b in body.buckets if b not in classify.REQUIRED_BUCKETS]
        if unknown:
            raise HTTPException(
                400,
                f"Unknown bucket(s) {unknown}; expected {list(classify.REQUIRED_BUCKETS)}.",
            )
    if body.margin is not None and not (0.0 <= body.margin <= 1.0):
        raise HTTPException(400, "margin must be between 0.0 and 1.0.")

    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        if body.margin is not None:
            scope_store.set_margin(conn, body.margin, actor=actor)
        for name, edit in (body.buckets or {}).items():
            scope_store.update_bucket(
                conn, name, anchors=edit.anchors, actor=actor,
            )
        defs = scope_store.get_definitions(conn)
    return {
        "org": user["org"],
        "margin": defs["margin"],
        "include_bucket": classify.INCLUDE_BUCKET,
        "editable_buckets": list(classify.REQUIRED_BUCKETS),
        "buckets": defs["buckets"],
    }


# --- ontology editor (node + edge types) ------------------------------------

class OntologyFieldEdit(BaseModel):
    field_key: str
    label: str
    description: str = ""
    is_list: bool = False


class OntologyEntityTypeEdit(BaseModel):
    key: str
    label: str
    description: str = ""
    page_folder: str | None = None
    fields: list[OntologyFieldEdit] = []


class OntologyRelationshipTypeEdit(BaseModel):
    key: str
    label: str
    description: str = ""
    subject_type: str | None = None
    object_type: str | None = None


class OntologyUpdate(BaseModel):
    entity_types: list[OntologyEntityTypeEdit]
    relationship_types: list[OntologyRelationshipTypeEdit]


def _serialize_ontology(ont) -> dict:
    return {
        "entity_types": [
            {
                "key": t.key,
                "label": t.label,
                "description": t.description,
                "page_folder": t.page_folder,
                "fields": [
                    {
                        "field_key": f.field_key,
                        "label": f.label,
                        "description": f.description,
                        "is_list": f.is_list,
                    }
                    for f in t.fields
                ],
            }
            for t in ont.entity_types
        ],
        "relationship_types": [
            {
                "key": r.key,
                "label": r.label,
                "description": r.description,
                "subject_type": r.subject_type,
                "object_type": r.object_type,
            }
            for r in ont.relationship_types
        ],
    }


@app.get("/api/admin/ontology")
def admin_get_ontology(user: dict = Depends(require_role("admin"))) -> dict:
    """This org's node + edge vocabulary (the ontology editor loads this).

    Entity types carry the structured fields the comprehend agents extract;
    relationship types carry their subject/object domain-range guardrail. Both
    drive detection at ingestion time, so editing them here changes what the
    brain looks for.
    """
    from src.db import ontology as ontology_repo
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        ont = ontology_repo.load_ontology(conn)
    return {"org": user["org"], **_serialize_ontology(ont)}


@app.put("/api/admin/ontology")
def admin_update_ontology(
    body: OntologyUpdate, user: dict = Depends(require_role("admin"))
) -> dict:
    """Replace this org's ontology with the supplied node + edge types.

    Full replace: types not present are removed. Removing a type that existing
    brain data still uses is rejected (409) — clear out or relabel the data
    first. Best run at onboarding, before any ingestion has happened.
    """
    import psycopg

    from src.db import ontology as ontology_repo
    from src.db.connection import get_tenant_connection

    if not body.entity_types:
        raise HTTPException(400, "Define at least one entity type.")

    entity_types = [
        ontology_repo.EntityTypeSpec(
            key=t.key,
            label=t.label,
            description=t.description,
            page_folder=(t.page_folder or "").strip() or f"{t.key}s",
            fields=[
                ontology_repo.FieldSpec(
                    field_key=f.field_key,
                    label=f.label,
                    description=f.description,
                    is_list=f.is_list,
                )
                for f in t.fields
            ],
        )
        for t in body.entity_types
    ]
    relationship_types = [
        ontology_repo.RelationshipTypeSpec(
            key=r.key,
            label=r.label,
            description=r.description,
            subject_type=r.subject_type,
            object_type=r.object_type,
        )
        for r in body.relationship_types
    ]

    actor = user.get("email") or f"user:{user.get('org')}"
    db_name = _tenant_db_for(user["org_id"])
    try:
        with get_tenant_connection(db_name) as conn:
            ontology_repo.save_ontology(
                conn, entity_types, relationship_types, actor=actor
            )
            ont = ontology_repo.load_ontology(conn)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except psycopg.errors.ForeignKeyViolation as exc:
        raise HTTPException(
            409,
            "Can't remove a type that brain data still uses. Relabel or clear "
            "that data first, then try again.",
        ) from exc
    return {"org": user["org"], **_serialize_ontology(ont)}


# --- starter (anchor) entities ----------------------------------------------

class StarterEntityBody(BaseModel):
    # The ontology type to place (e.g. "company", "person") and the canonical
    # name. Optional one-line description seeds the page's blurb.
    entity_type: str
    name: str
    description: str | None = None
    # Mark this the workspace's center of gravity (one per workspace), and/or
    # attach its email address (used by email-based entity resolution).
    is_principal: bool = False
    email: str | None = None


def _serialize_seeded_page(page: dict) -> dict:
    """Flatten a stored starter page into what the Admin Center lists."""
    data = page.get("data") or {}
    fm = data.get("frontmatter") or {}
    return {
        "page_path": page["page_path"],
        "entity_type": page["entity_type"],
        "name": fm.get("name") or "",
        "description": data.get("description") or "",
        "is_principal": bool(data.get("is_principal")),
        "email": fm.get("email") or "",
    }


@app.get("/api/admin/starter-entities")
def admin_list_starter_entities(
    user: dict = Depends(require_role("admin")),
) -> dict:
    """The anchor entities an admin has hand-placed in this tenant's brain.

    These are the pre-created pages later email mentions canonicalize onto, so
    references resolve to one page instead of spawning duplicates. Lists only
    the hand-placed anchors, not pages the comprehend pipeline built from mail.
    """
    from src.db import brain_pages as brain_pages_repo
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        pages = brain_pages_repo.list_seeded_pages(conn)
    return {
        "org": user["org"],
        "starters": [_serialize_seeded_page(p) for p in pages],
    }


@app.post("/api/admin/starter-entities")
def admin_add_starter_entity(
    body: StarterEntityBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Pre-create one anchor entity of a given ontology type.

    Idempotent on the entity's page path: placing the same type + name twice
    leaves the first page untouched. Best run at onboarding, before ingestion,
    so the known company/people/projects exist for later mail to attach to.
    """
    from src.db import brain_pages as brain_pages_repo
    from src.db import ontology as ontology_repo
    from src.db.connection import get_tenant_connection
    from src.seed import starter_entities

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        ontology = ontology_repo.load_ontology(conn)
        try:
            starter_entities.seed_entity(
                conn,
                ontology,
                entity_type=body.entity_type,
                name=body.name,
                description=body.description,
                is_principal=body.is_principal,
                email=body.email,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        pages = brain_pages_repo.list_seeded_pages(conn)
    return {
        "org": user["org"],
        "starters": [_serialize_seeded_page(p) for p in pages],
    }


class StarterEntityUpdateBody(StarterEntityBody):
    # The page_path of the anchor being edited (its current identity). The new
    # type/name may re-key it to a different page, so we need the old key to
    # find and remove it first.
    page_path: str


@app.put("/api/admin/starter-entities")
def admin_update_starter_entity(
    body: StarterEntityUpdateBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Edit a hand-placed anchor — including fixing its TYPE (e.g. Person → Company).

    Because an anchor is keyed by its type + name, editing is a remove-then-place:
    the old page + its graph node/edges/chunks are dropped and a fresh anchor is
    seeded with the new fields. Best used at onboarding, before email has built
    relationships onto the entity.
    """
    from src.db import brain_pages as brain_pages_repo
    from src.db import ontology as ontology_repo
    from src.db.connection import get_tenant_connection
    from src.seed import starter_entities

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        ontology = ontology_repo.load_ontology(conn)
        try:
            starter_entities.update_starter_entity(
                conn,
                ontology,
                old_page_path=body.page_path,
                entity_type=body.entity_type,
                name=body.name,
                description=body.description,
                is_principal=body.is_principal,
                email=body.email,
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        pages = brain_pages_repo.list_seeded_pages(conn)
    return {
        "org": user["org"],
        "starters": [_serialize_seeded_page(p) for p in pages],
    }


@app.delete("/api/admin/starter-entities")
def admin_delete_starter_entity(
    page_path: str, user: dict = Depends(require_role("admin"))
) -> dict:
    """Remove a hand-placed anchor entirely (its page + graph node/edges/chunks).

    Only deletes seeded anchors — a page the comprehend pipeline built from email
    is left untouched (returns 404 so the admin knows nothing was removed).
    """
    from src.db import brain_pages as brain_pages_repo
    from src.db.connection import get_tenant_connection
    from src.seed import starter_entities

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        removed = starter_entities.delete_seeded_entity(conn, page_path)
        if not removed:
            raise HTTPException(404, "No such starter entity.")
        pages = brain_pages_repo.list_seeded_pages(conn)
    return {
        "org": user["org"],
        "starters": [_serialize_seeded_page(p) for p in pages],
    }


# --- team / members (tenant-admin self-service) -----------------------------
# The Control Tower also manages members, but only the platform owner can reach
# it — so the operator must seed the FIRST admin there (otherwise no one can log
# in to reach the wizard). Once a tenant admin is in, these endpoints let them
# invite teammates themselves, scoped to their own org. Same store as the
# owner-side path; the actor is the admin, not the owner.

class AdminMemberBody(BaseModel):
    email: str
    role: str = "consultant"


@app.get("/api/admin/members")
def admin_list_members(user: dict = Depends(require_role("admin"))) -> dict:
    return {"org": user["org"], "members": service.list_members(user["org"])}


@app.post("/api/admin/members")
def admin_add_member(
    body: AdminMemberBody, user: dict = Depends(require_role("admin"))
) -> dict:
    actor = user.get("email") or user["org"]
    try:
        added = service.add_member(user["org"], body.email, body.role, actor=actor)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"member": added, "members": service.list_members(user["org"])}


# --- customer-facing brain Q&A ----------------------------------------------

class QaAskBody(BaseModel):
    question: str


@app.post("/api/qa/ask")
def qa_ask(body: QaAskBody, user: dict = Depends(current_user)) -> dict:
    """Ask a natural-language question over the caller org's brain.

    Open to any signed-in member (not just admins) — this is the everyday
    product surface. It reads ONLY the caller's tenant brain and bills the
    caller's org for the LLM synthesis, so cross-tenant data never mixes and
    a workspace that has run out of credits is stopped before the call fires.
    Returns ``{question_id, answer, sources}``; the Q&A is saved to the tenant
    brain so it can be replayed without re-paying for retrieval + synthesis.
    """
    from src import qa
    from src.billing import metering
    from src.db import questions as questions_repo
    from src.db.connection import get_tenant_connection

    question = (body.question or "").strip()
    if not question:
        raise HTTPException(400, "Ask a question.")

    db_name = _tenant_db_for(user["org_id"])
    org_tok = metering.set_current_org(user["org_id"])
    usr_tok = metering.set_current_user(_session_user_id(user))
    try:
        with get_tenant_connection(db_name) as conn:
            # Mint the question id BEFORE synthesis so the LLM usage event carries
            # it in meta (set_current_question_id) — that's the join key the Ask
            # observability table uses to attribute token/cost back per question.
            qid = questions_repo.create_question(question, conn=conn)
            conn.commit()
            qid_tok = metering.set_current_question_id(qid)
            try:
                result = qa.ask(question, conn=conn)
            except metering.CreditLimitExceeded:
                raise HTTPException(
                    402,
                    "This workspace is out of credits. Add credits to keep asking.",
                )
            finally:
                metering.reset_current_question_id(qid_tok)
            questions_repo.finalize_question(
                qid,
                result.get("answer", ""),
                result.get("sources", []),
                conn=conn,
            )
            conn.commit()
    finally:
        metering.reset_current_org(org_tok)
        metering.reset_current_user(usr_tok)

    result["question_id"] = qid
    return result


@app.get("/api/qa/graph")
def qa_graph(user: dict = Depends(current_user)) -> dict:
    """The caller org's whole brain as a knowledge graph (entities + relations).

    Open to any signed-in member, like ``/api/qa/ask`` — it reads ONLY the
    caller's tenant brain and returns no email content, just the entity nodes
    and the relationships between them, so the Ask page can render the same 3D
    graph the product demo shows. Node ``val`` is the entity's degree (how many
    relationships touch it) so well-connected entities render larger; the short
    ``description`` (when present) feeds the hover tooltip.
    """
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT e.id, e.type, e.name, e.page_path,
                   (SELECT c.text FROM chunks c
                      WHERE c.entity_id = e.id AND c.section = 'description'
                      ORDER BY c.id LIMIT 1) AS description
            FROM entities e
            ORDER BY e.id;
            """
        )
        entity_rows = cur.fetchall()
        cur.execute("SELECT subject, predicate, object FROM relationships;")
        rel_rows = cur.fetchall()

    # Degree per entity (a relationship adds to both endpoints), used for node size.
    degree: dict[int, int] = {}
    for subj, _pred, obj in rel_rows:
        degree[subj] = degree.get(subj, 0) + 1
        degree[obj] = degree.get(obj, 0) + 1

    def _short(text: str | None) -> str | None:
        if not text:
            return None
        text = " ".join(text.split())
        return text if len(text) <= 160 else text[:157].rstrip() + "…"

    nodes = [
        {
            "id": str(eid),
            "label": name,
            "type": etype,
            "group": etype,
            "description": _short(description),
            # page_path lets a clicked node open its full brain page (the Ask
            # page's detail panel fetches /api/qa/pages and looks it up by this).
            "page_path": page_path,
            # Size: a floor of 4 so isolated entities are still visible, capped
            # at 30 so a hub doesn't dwarf the rest.
            "val": min(4 + degree.get(eid, 0), 30),
        }
        for eid, etype, name, page_path, description in entity_rows
    ]
    links = [
        {"source": str(subj), "target": str(obj), "label": pred}
        for subj, pred, obj in rel_rows
    ]
    return {"nodes": nodes, "links": links}


@app.get("/api/qa/pages")
def qa_pages(user: dict = Depends(current_user)) -> dict:
    """Every brain page in full, for the Ask page's Pages tab and the graph's
    node-detail panel.

    Open to any signed-in member, like ``/api/qa/graph``. Reads ONLY the caller's
    tenant brain and returns each page exactly as the comprehend pipeline wrote
    it — ``frontmatter`` (the structured fields), ``description``, ``timeline``,
    and the outgoing ``relationships``. The frontend groups these by entity type.
    """
    from src.db.connection import get_tenant_connection
    from src.db import brain_pages as brain_pages_repo

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        rows = brain_pages_repo.list_pages(conn)

    pages = [
        {
            "page_path": r["page_path"],
            "entity_type": r["entity_type"],
            "name": (r["data"].get("frontmatter") or {}).get("name") or r["page_path"],
            "data": r["data"],
        }
        for r in rows
    ]
    return {"pages": pages}


@app.get("/api/qa/documents")
def qa_documents(user: dict = Depends(current_user)) -> dict:
    """Every Google Drive document captured into the brain, with its Markdown.

    Backs the Ask page's Documents tab. Documents live only as chunks (never graph
    nodes), so this reads them straight from ``captured_events`` (source='file'):
    the filename (``subject``), the Drive path + link + mime type (from ``raw``),
    when it was last modified, whether it's been comprehended (``processed_at``),
    and the full converted Markdown (``body_text``). Open to any signed-in member,
    like ``/api/qa/pages``; reads ONLY the caller's tenant brain.
    """
    from src.db.connection import get_tenant_connection

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT external_id, subject, body_text, occurred_at, processed_at,
                   raw->>'path'        AS path,
                   raw->>'webViewLink' AS web_view_link,
                   raw->>'mimeType'    AS mime_type
            FROM captured_events
            WHERE source = 'file'
            ORDER BY COALESCE(raw->>'path', subject), subject;
            """
        )
        rows = cur.fetchall()

    documents = [
        {
            "file_id": r[0],
            "filename": r[1],
            "markdown": r[2] or "",
            "modified_time": r[3].isoformat() if r[3] else None,
            "comprehended": r[4] is not None,
            "path": r[5],
            "web_view_link": r[6],
            "mime_type": r[7],
        }
        for r in rows
    ]
    return {"documents": documents}


# --- Delivery: per-user to-do pool (next-24h action items from the brain) ----

# A forced refresh can't run more often than this (per user), so the Sync-now
# button can't be spammed into repeated metered inferences.
_DELIVERY_REFRESH_MIN_AGE_SECONDS = 30


def _delivery_response(pool: dict | None, dismissed: set[str] | None = None) -> dict:
    """Shape a stored pool (or None) into the API response, filtering out items
    the user already acted on (``dismissed`` = normalized title keys) so a
    pre-existing cached pool doesn't re-surface them."""
    if not pool:
        return {"todos": [], "suggestions": [], "refreshed_at": None}
    d = dismissed or set()
    keep = lambda x: (x.get("title") or "").strip().lower() not in d  # noqa: E731
    computed = pool.get("computed_at")
    return {
        "todos": [t for t in (pool.get("todos") or []) if keep(t)],
        "suggestions": [s for s in (pool.get("suggestions") or []) if keep(s)],
        "refreshed_at": computed.isoformat() if computed else None,
    }


@app.get("/api/qa/delivery")
def qa_delivery(user: dict = Depends(current_user)) -> dict:
    """The caller's Delivery to-do pool — what they must act on in the next 24h.

    Served from the cache the 3-hourly scheduler job computes (see
    ``scheduler._refresh_delivery_pools``). Lazy fallback: if no pool exists yet
    (a member between scheduler runs), compute it once on demand so the tab is
    never empty. Reads ONLY the caller's tenant brain; matches the caller's email
    to their entity inside ``compute_pool_for_user``.
    """
    from src.billing import metering
    from src.db.connection import get_tenant_connection
    from src.db import delivery_store
    from src.ingestion import delivery

    email = user.get("email")
    if not email:
        return {"todos": [], "refreshed_at": None}
    db_name = _tenant_db_for(user["org_id"])
    # Attribute any on-demand compute to the caller's org + user, so the metered
    # DeliveryAgent cost shows in this workspace's Egress · Delivery observability
    # (mirrors qa_ask and the scheduler job).
    org_tok = metering.set_current_org(user["org_id"])
    usr_tok = metering.set_current_user(_session_user_id(user))
    try:
        with get_tenant_connection(db_name) as conn:
            pool = delivery_store.get_pool(conn, email)
            # Compute on first visit OR when the cached pool is empty — the latter
            # heals a stale empty row left by an older build (which never carried
            # suggestions), so the tab self-fills without waiting for the 3h job.
            if pool is None or not (pool.get("todos") or pool.get("suggestions")):
                computed = delivery.compute_pool_for_user(conn, email)
                delivery_store.upsert_pool(conn, email, computed["todos"], computed["suggestions"])
                pool = delivery_store.get_pool(conn, email)
            dismissed = set(delivery_store.get_dismissed(conn, email))
    finally:
        metering.reset_current_user(usr_tok)
        metering.reset_current_org(org_tok)
    return _delivery_response(pool, dismissed)


@app.post("/api/qa/delivery/refresh")
def qa_delivery_refresh(user: dict = Depends(current_user)) -> dict:
    """Sync on demand — recompute the caller's pool now, ignoring the 3h gate.

    One metered brain inference. Rate-limited per user (a pool younger than
    ``_DELIVERY_REFRESH_MIN_AGE_SECONDS`` is returned as-is) so the button can't be
    spammed.
    """
    from src.billing import metering
    from src.db.connection import get_tenant_connection
    from src.db import delivery_store
    from src.ingestion import delivery

    email = user.get("email")
    if not email:
        return {"todos": [], "refreshed_at": None}
    db_name = _tenant_db_for(user["org_id"])
    org_tok = metering.set_current_org(user["org_id"])
    usr_tok = metering.set_current_user(_session_user_id(user))
    try:
        with get_tenant_connection(db_name) as conn:
            dismissed = set(delivery_store.get_dismissed(conn, email))
            age = delivery_store.pool_age_seconds(conn, email)
            if age is not None and age < _DELIVERY_REFRESH_MIN_AGE_SECONDS:
                return _delivery_response(delivery_store.get_pool(conn, email), dismissed)
            computed = delivery.compute_pool_for_user(conn, email)
            delivery_store.upsert_pool(conn, email, computed["todos"], computed["suggestions"])
            pool = delivery_store.get_pool(conn, email)
    finally:
        metering.reset_current_user(usr_tok)
        metering.reset_current_org(org_tok)
    return _delivery_response(pool, dismissed)


class DeliveryDismissBody(BaseModel):
    # The item's stable key (its title); marks it acted-on so it isn't re-suggested.
    key: str


@app.post("/api/qa/delivery/dismiss")
def qa_delivery_dismiss(
    body: DeliveryDismissBody, user: dict = Depends(current_user)
) -> dict:
    """Record that the caller acted on an item (delegated/completed it), so the
    next regeneration excludes it and fills the slot with a different next step.
    Returns the caller's pool with the dismissed items filtered out."""
    from src.db.connection import get_tenant_connection
    from src.db import delivery_store

    email = user.get("email")
    if not email or not (body.key or "").strip():
        return {"todos": [], "suggestions": [], "refreshed_at": None}
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        delivery_store.add_dismissed(conn, email, body.key)
        dismissed = set(delivery_store.get_dismissed(conn, email))
        pool = delivery_store.get_pool(conn, email)
    return _delivery_response(pool, dismissed)


class DeliveryCompleteBody(BaseModel):
    # The completed item's human-readable title — written to the brain timeline
    # and used (normalized) as the dismiss key so it isn't re-suggested.
    title: str


@app.post("/api/qa/delivery/complete")
def qa_delivery_complete(
    body: DeliveryCompleteBody, user: dict = Depends(current_user)
) -> dict:
    """Mark a delivery task complete: write a dated, self-reported entry to the
    caller's brain page (re-indexed so Q&A + future agenda inference see it) AND
    dismiss it so it isn't re-surfaced. Returns the caller's filtered pool.

    Distinct from /dismiss (hide only): completing grounds the action in the
    brain; dismissing just acknowledges it."""
    import logging

    from src.db.connection import get_tenant_connection
    from src.db import delivery_store
    from src.ingestion import delivery

    email = user.get("email")
    title = (body.title or "").strip()
    if not email or not title:
        return {"todos": [], "suggestions": [], "refreshed_at": None}
    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        # Best-effort brain write — a write hiccup must not lose the completion
        # acknowledgement, so dismiss regardless.
        try:
            delivery.record_completion(conn, email, title)
        except Exception:
            logging.getLogger(__name__).exception("delivery completion write failed")
        delivery_store.add_dismissed(conn, email, delivery.dismiss_key(title))
        dismissed = set(delivery_store.get_dismissed(conn, email))
        pool = delivery_store.get_pool(conn, email)
    return _delivery_response(pool, dismissed)


@app.get("/api/qa/questions")
def qa_questions(user: dict = Depends(current_user)) -> dict:
    """Recent Q&A for the caller's workspace, most recent first.

    Backs the Ask page's history list. Reads ONLY the caller's tenant brain;
    returns id + question + timestamp (not the stored answer) so the list is
    cheap — the answer is fetched on click via ``/api/qa/questions/{id}``.
    """
    from src.db.connection import get_tenant_connection
    from src.db import questions as questions_repo

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        items = questions_repo.list_questions(conn=conn)
    return {"questions": items}


@app.get("/api/qa/questions/{question_id}")
def qa_question(question_id: int, user: dict = Depends(current_user)) -> dict:
    """Replay one saved Q&A (question + answer + sources) by id.

    Renders a past answer with no LLM/retrieval cost — the sources were stored
    verbatim when the question was first asked. Tenant-scoped: a question id
    that belongs to another workspace simply isn't found here.
    """
    from src.db.connection import get_tenant_connection
    from src.db import questions as questions_repo

    db_name = _tenant_db_for(user["org_id"])
    with get_tenant_connection(db_name) as conn:
        row = questions_repo.get_question(question_id, conn=conn)
    if row is None:
        raise HTTPException(404, "Question not found.")
    return row


# --- MCP access tokens (remote connector credentials) -----------------------

class McpTokenCreate(BaseModel):
    label: str | None = None
    # The MCP is read-only ('brain:read' only); any other scope is dropped at mint.
    scopes: list[str] | None = None


@app.get("/api/admin/mcp/tokens")
def admin_list_mcp_tokens(user: dict = Depends(require_role("admin"))) -> dict:
    """List this workspace's MCP connector tokens (no secrets, ever)."""
    from src.auth import mcp_tokens

    return {"tokens": mcp_tokens.list_for_org(user["org_id"])}


@app.post("/api/admin/mcp/tokens")
def admin_create_mcp_token(
    body: McpTokenCreate, user: dict = Depends(require_role("admin"))
) -> dict:
    """Mint an MCP bearer token for this workspace, bound to the admin who
    created it. The raw token is returned ONCE here and never recoverable —
    paste it into the MCP client (Claude / ChatGPT) as the bearer credential.
    """
    from src.auth import mcp_tokens

    raw, record = mcp_tokens.mint(
        user_id=int(user["sub"]),
        org_id=user["org_id"],
        scopes=body.scopes,
        label=(body.label or "").strip() or None,
    )
    audit.record_event(
        "mcp_token_created",
        org_id=user["org_id"],
        actor=user.get("email") or user["org"],
        detail={"token_id": record["id"], "scopes": record["scopes"]},
    )
    return {"token": raw, "record": record}


@app.delete("/api/admin/mcp/tokens/{token_id}")
def admin_revoke_mcp_token(
    token_id: int, user: dict = Depends(require_role("admin"))
) -> dict:
    """Revoke an MCP token. Scoped to the caller's workspace."""
    from src.auth import mcp_tokens

    if not mcp_tokens.revoke(token_id, user["org_id"]):
        raise HTTPException(404, "No such token in this workspace.")
    audit.record_event(
        "mcp_token_revoked",
        org_id=user["org_id"],
        actor=user.get("email") or user["org"],
        detail={"token_id": token_id},
    )
    return {"ok": True, "tokens": mcp_tokens.list_for_org(user["org_id"])}


# --- MCP OAuth consent (workspace pick) -------------------------------------
# The MCP SDK serves /authorize, /token, /register, /revoke and discovery. The
# one custom step is authenticating the human + letting them choose a workspace:
# the OAuth provider's authorize() bounces the browser here with a signed pending
# request (rid); this page reuses iota_session, then issues the auth code.

def _user_memberships(user_id: int) -> list[dict]:
    from src.db.connection import get_control_connection

    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT m.org_id, o.slug, o.name, m.role FROM memberships m "
            "JOIN organizations o ON o.id = m.org_id "
            "WHERE m.user_id = %s ORDER BY o.name;",
            (user_id,),
        )
        return [
            {"org_id": r[0], "slug": r[1], "name": r[2], "role": r[3]}
            for r in cur.fetchall()
        ]


def _consent_login_redirect(request: Request) -> RedirectResponse:
    """No session yet → send the user to sign in, returning here afterwards."""
    nxt = quote(str(request.url), safe="")
    return RedirectResponse(f"{LINK_BASE}/?next={nxt}", status_code=302)


def _consent_page(rid: str, cot: str, client_name: str, memberships: list[dict],
                  scopes: list[str], email: str | None) -> str:
    scope_labels = {
        "brain:read": "Read your brain — search, entities, and the relationship graph.",
    }
    scope_html = "".join(
        f'<li><b>{s}</b> — {scope_labels.get(s, s)}</li>' for s in scopes
    ) or "<li>Read access to your brain.</li>"
    options = "".join(
        f'<label class="ws"><input type="radio" name="org_id" value="{m["org_id"]}"'
        f'{" checked" if i == 0 else ""}>'
        f'<span><b>{_html_escape(m["name"])}</b> '
        f'<span class="slug">{_html_escape(m["slug"])}</span> · {m["role"]}</span></label>'
        for i, m in enumerate(memberships)
    )
    who = f'<p class="who">Signed in as {_html_escape(email)}</p>' if email else ""
    return f"""<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize {_html_escape(client_name)} · Indigo Iota</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ font: 15px/1.5 -apple-system, system-ui, sans-serif; background:#f5f5f4;
         margin:0; display:flex; min-height:100vh; align-items:center; justify-content:center; }}
  .card {{ background:#fff; max-width:440px; width:92%; border:1px solid #e7e5e4;
          border-radius:16px; padding:28px 26px; box-shadow:0 1px 3px rgba(0,0,0,.06); }}
  h1 {{ font-size:18px; margin:0 0 4px; }}
  .brand {{ font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#6d28d9; font-weight:600; }}
  .who {{ color:#78716c; font-size:13px; margin:.2em 0 1.2em; }}
  ul {{ padding-left:18px; margin:.5em 0 1.2em; color:#44403c; font-size:13.5px; }}
  .ws {{ display:flex; gap:10px; align-items:center; border:1px solid #e7e5e4; border-radius:10px;
         padding:10px 12px; margin:6px 0; cursor:pointer; }}
  .ws .slug {{ font-family:ui-monospace,monospace; font-size:11px; color:#a8a29e; }}
  .row {{ display:flex; gap:10px; margin-top:18px; }}
  button {{ flex:1; padding:10px 14px; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; border:1px solid transparent; }}
  .allow {{ background:#6d28d9; color:#fff; }}
  .deny {{ background:#fff; border-color:#e7e5e4; color:#44403c; }}
  .lbl {{ font-size:12px; font-weight:600; color:#78716c; text-transform:uppercase; letter-spacing:.05em; margin:6px 0; }}
</style></head><body>
<form class="card" method="post" action="/mcp/consent">
  <div class="brand">Indigo Iota</div>
  <h1>Authorize {_html_escape(client_name)}</h1>
  {who}
  <p>This connector is requesting access to one of your workspaces:</p>
  <ul>{scope_html}</ul>
  <div class="lbl">Workspace</div>
  {options}
  <input type="hidden" name="rid" value="{_html_escape(rid)}">
  <input type="hidden" name="cot" value="{_html_escape(cot)}">
  <div class="row">
    <button class="deny" name="decision" value="deny" type="submit">Deny</button>
    <button class="allow" name="decision" value="allow" type="submit">Allow access</button>
  </div>
</form></body></html>"""


def _html_escape(s: str | None) -> str:
    s = s or ""
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace('"', "&quot;"))


@app.get("/mcp/consent")
def mcp_consent(request: Request, rid: str = Query(...)) -> Response:
    from src.auth import mcp_oauth

    pending = mcp_oauth.read_pending(rid)
    if not pending:
        return HTMLResponse(
            "<h1>This authorization request has expired.</h1>"
            "<p>Please start again from your MCP client.</p>",
            status_code=400,
        )
    data = sessions.read_session(request.cookies.get(sessions.COOKIE_NAME))
    if not data:
        return _consent_login_redirect(request)
    memberships = _user_memberships(int(data["sub"]))
    if not memberships:
        return HTMLResponse(
            "<h1>No workspaces</h1><p>Your account isn't a member of any Indigo "
            "Iota workspace.</p>",
            status_code=403,
        )
    client = mcp_oauth.get_client(pending["cid"])
    client_name = (client.client_name if client else None) or "An MCP client"
    cot = mcp_oauth.sign_consent(user_id=int(data["sub"]), rid=rid)
    return HTMLResponse(_consent_page(
        rid=rid,
        cot=cot,
        client_name=client_name,
        memberships=memberships,
        scopes=pending.get("sc") or [],
        email=data.get("email"),
    ))


@app.post("/mcp/consent")
async def mcp_consent_submit(request: Request) -> Response:
    from src.auth import mcp_oauth

    form = await request.form()
    rid = form.get("rid")
    decision = form.get("decision")
    pending = mcp_oauth.read_pending(rid)
    if not pending:
        return HTMLResponse("<h1>This authorization request has expired.</h1>", status_code=400)
    data = sessions.read_session(request.cookies.get(sessions.COOKIE_NAME))
    if not data:
        return _consent_login_redirect(request)
    user_id = int(data["sub"])
    redirect_uri = pending["ru"]
    state = pending.get("st")

    # CSRF: the approval must carry the session-bound token issued when this
    # user's browser rendered the consent form for this exact request.
    if not mcp_oauth.verify_consent(form.get("cot"), user_id=user_id, rid=rid):
        return HTMLResponse(
            "<h1>Could not verify this request.</h1>"
            "<p>Please restart the authorization from your MCP client.</p>",
            status_code=400,
        )

    if decision != "allow":
        return RedirectResponse(
            construct_redirect_uri(
                redirect_uri, error="access_denied",
                error_description="The user denied the request.", state=state,
            ),
            status_code=302,
        )

    allowed = {m["org_id"] for m in _user_memberships(user_id)}
    try:
        org_id = int(form.get("org_id"))
    except (TypeError, ValueError):
        org_id = None
    if org_id not in allowed:
        return HTMLResponse("<h1>Invalid workspace selection.</h1>", status_code=400)

    scopes = pending.get("sc") or []
    code_raw = secrets.token_urlsafe(32)
    mcp_oauth.save_auth_code(
        code_raw,
        client_id=pending["cid"],
        user_id=user_id,
        org_id=org_id,
        scopes=scopes,
        code_challenge=pending["cc"],
        redirect_uri=redirect_uri,
        redirect_uri_provided_explicitly=pending.get("rue", True),
        resource=pending.get("res"),
    )
    audit.record_event(
        "mcp_oauth_authorized",
        org_id=org_id,
        actor=data.get("email"),
        detail={"client_id": pending["cid"], "scopes": scopes},
    )
    return RedirectResponse(
        construct_redirect_uri(redirect_uri, code=code_raw, state=state),
        status_code=302,
    )


# --- dev-only login bypass --------------------------------------------------

class DevLoginBody(BaseModel):
    slug: str
    email: str


@app.post("/auth/dev-login")
def dev_login(body: DevLoginBody) -> Response:
    """Issue a session for an existing member WITHOUT Microsoft. DEV ONLY.

    Gated behind IOTA_DEV_LOGIN=1 so it can never be reached in production. Lets
    us build the Admin Center and demo flows before a customer's Entra tenant is
    wired up.
    """
    if os.environ.get("IOTA_DEV_LOGIN") != "1":
        raise HTTPException(404, "Not found.")
    row = service.lookup_member_by_email(body.slug, body.email)
    if not row:
        audit.record_event(
            "login_denied",
            actor=body.email,
            detail={"method": "dev", "slug": body.slug, "reason": "no_membership"},
        )
        raise HTTPException(403, f"No membership for {body.email!r} in org {body.slug!r}.")
    org_id, org_slug, user_id, email, role = row
    audit.record_event(
        "login",
        org_id=org_id,
        actor=email,
        detail={"method": "dev", "role": role, "user_id": user_id},
    )
    session = sessions.issue_session(
        user_id=user_id, org_id=org_id, org_slug=org_slug, role=role, email=email
    )
    resp = JSONResponse({"ok": True, "org": org_slug, "role": role, "email": email})
    _set_cookie(resp, sessions.COOKIE_NAME, session, max_age=sessions.SESSION_TTL)
    return resp


# --- native auth: invite, onboarding, login, reset --------------------------
# Sign-in for organizations with auth_method='native' (IMAP customers, no
# Microsoft). The whole flow lives here; the heavy lifting is in
# src.auth.native_auth (DB + crypto) and src.auth.challenge (the MFA cookie).

@app.get("/auth/{slug}/method")
def auth_method(slug: str) -> dict:
    """Which sign-in form the login page should show for this workspace:
    'native' (email + password + authenticator) or 'entra' (Microsoft). Unknown
    slugs report 'entra' so this can't be used to discover which orgs exist."""
    return {"auth_method": native_auth.auth_method_for_org((slug or "").strip())}


class InviteMemberBody(BaseModel):
    email: str
    role: str = "consultant"


class SetPasswordBody(BaseModel):
    token: str
    password: str


class TotpBeginBody(BaseModel):
    token: str


class TotpConfirmBody(BaseModel):
    token: str
    code: str


class NativeLoginBody(BaseModel):
    email: str
    password: str


class TotpLoginBody(BaseModel):
    code: str


class ResetRequestBody(BaseModel):
    email: str


class ResetConfirmBody(BaseModel):
    token: str
    password: str


def _send_invite_email(email: str, org_name: str, link: str) -> None:
    text = (
        f"You've been invited to Indigo Iota ({org_name}).\n\n"
        f"Set your password and finish setting up your account here:\n{link}\n\n"
        f"This link can be used once and expires in {native_auth.INVITE_TTL_HOURS} hours. "
        "If you weren't expecting this, you can ignore this email."
    )
    html = (
        f"<p>You've been invited to <strong>Indigo Iota</strong> ({org_name}).</p>"
        f"<p><a href=\"{link}\">Set your password and finish setup</a></p>"
        f"<p style=\"color:#666;font-size:13px\">This link can be used once and expires "
        f"in {native_auth.INVITE_TTL_HOURS} hours. If you weren't expecting this, ignore "
        "this email.</p>"
    )
    mailer.send_email(email, "Your Indigo Iota invitation", text, html)


def _send_reset_email(email: str, link: str) -> None:
    text = (
        "We received a request to reset your Indigo Iota password.\n\n"
        f"Reset it here:\n{link}\n\n"
        f"This link can be used once and expires in {native_auth.RESET_TTL_HOURS} hour. "
        "If you didn't ask for this, you can safely ignore this email."
    )
    html = (
        "<p>We received a request to reset your <strong>Indigo Iota</strong> password.</p>"
        f"<p><a href=\"{link}\">Reset your password</a></p>"
        f"<p style=\"color:#666;font-size:13px\">This link can be used once and expires in "
        f"{native_auth.RESET_TTL_HOURS} hour. If you didn't ask for this, ignore this email.</p>"
    )
    mailer.send_email(email, "Reset your Indigo Iota password", text, html)


@app.post("/api/admin/members/invite")
def invite_member(
    body: InviteMemberBody, user: dict = Depends(require_role("admin"))
) -> dict:
    """Admin invites a teammate by email into their own (native-auth) org. Creates
    the membership and emails a single-use link to set a password + enrol MFA."""
    slug = user["org"]
    if not native_auth.org_uses_native(slug):
        raise HTTPException(
            400, "Invites are only for password-based organizations. This org uses "
            "Microsoft sign-in."
        )
    email = (body.email or "").strip().lower()
    if "@" not in email:
        raise HTTPException(400, "Enter a valid email address.")
    try:
        member = service.add_member(slug, email, body.role, actor=user.get("email") or "admin")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    raw = native_auth.issue_invite(member["user_id"])
    link = f"{LINK_BASE}/accept-invite?token={raw}"
    org_name = next((o["name"] for o in service.organizations_overview() if o["slug"] == slug), slug)
    try:
        _send_invite_email(email, org_name, link)
    except Exception as exc:  # mail send failed — surface it, the membership stands
        raise HTTPException(502, f"Member added but the invite email failed to send: {exc}") from exc
    audit.record_event(
        "member_invited", org_id=user["org_id"], actor=user.get("email"),
        detail={"email": email, "role": body.role},
    )
    return {"ok": True, "email": email, "role": body.role}


@app.get("/auth/native/invite")
def invite_lookup(token: str = Query(...)) -> dict:
    """Is this invite link still valid? Returns the email so the accept page can
    greet the user. Never reveals anything for an invalid/expired/used token."""
    found = native_auth.peek_token(token, "invite")
    if not found:
        return {"valid": False}
    return {"valid": True, "email": found[1]}


@app.post("/auth/native/onboard/set-password")
def onboard_set_password(body: SetPasswordBody) -> dict:
    """Step 1 of accepting an invite: set the first password. The invite token
    authorizes this; it is NOT consumed yet (MFA enrolment must still happen)."""
    found = native_auth.peek_token(body.token, "invite")
    if not found:
        raise HTTPException(400, "This invitation link is invalid or has expired.")
    user_id, email = found
    try:
        native_auth.set_password(user_id, body.password, email=email)
    except WeakPasswordError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


@app.post("/auth/native/onboard/totp/begin")
def onboard_totp_begin(body: TotpBeginBody) -> dict:
    """Step 2: hand back the authenticator secret (QR + backup codes) to enrol.
    Requires the password to have been set first."""
    found = native_auth.peek_token(body.token, "invite")
    if not found:
        raise HTTPException(400, "This invitation link is invalid or has expired.")
    user_id, email = found
    if not native_auth.has_password(user_id):
        raise HTTPException(400, "Set your password before adding an authenticator.")
    try:
        return native_auth.begin_enrollment(user_id, email)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/auth/native/onboard/totp/confirm")
def onboard_totp_confirm(body: TotpConfirmBody) -> Response:
    """Step 3: confirm enrolment with a live code. On success the invite token is
    spent, the account becomes usable, and the user is signed in."""
    found = native_auth.peek_token(body.token, "invite")
    if not found:
        raise HTTPException(400, "This invitation link is invalid or has expired.")
    user_id, email = found
    if not native_auth.confirm_enrollment(user_id, body.code):
        raise HTTPException(400, "That code didn't match. Check your authenticator app and try again.")
    # Enrolment confirmed — spend the invite so the link can't be reused.
    if native_auth.consume_token(body.token, "invite") is None:
        raise HTTPException(400, "This invitation link is invalid or has expired.")
    # Resolve org + role for the session from the membership.
    ident = native_auth.identity_for_user(user_id)
    if ident is None:
        raise HTTPException(409, "Your membership could not be found. Contact your administrator.")
    audit.record_event(
        "login", org_id=ident.org_id, actor=email,
        detail={"method": "native", "event": "onboarding_complete", "role": ident.role},
    )
    session = sessions.issue_session(
        user_id=ident.user_id, org_id=ident.org_id, org_slug=ident.org_slug,
        role=ident.role, email=ident.email,
    )
    resp = JSONResponse({"ok": True, "org": ident.org_slug, "role": ident.role, "email": ident.email})
    _set_cookie(resp, sessions.COOKIE_NAME, session, max_age=sessions.SESSION_TTL)
    return resp


@app.post("/auth/{slug}/native/login")
def native_login(slug: str, body: NativeLoginBody) -> Response:
    """Step 1 of sign-in: verify email + password. On success, set the 5-minute
    MFA cookie and tell the client to ask for the authenticator code. Failures
    are deliberately uniform (no 'wrong password' vs 'no such user')."""
    email = (body.email or "").strip().lower()
    result = native_auth.verify_login(slug, email, body.password)
    if result.status == "locked":
        audit.record_event("login_denied", actor=email,
                            detail={"method": "native", "slug": slug, "reason": "locked"})
        raise HTTPException(
            429, "Too many attempts. Try again later.",
            headers={"Retry-After": str(result.retry_after_seconds or 60)},
        )
    if result.status == "mfa_incomplete":
        raise HTTPException(403, "Your account setup isn't finished. Use your invite link, "
                                 "or ask your administrator to resend it.")
    if result.status != "ok" or result.identity is None:
        audit.record_event("login_denied", actor=email,
                            detail={"method": "native", "slug": slug, "reason": "bad_credentials"})
        raise HTTPException(401, "Incorrect email or password.")

    ident = result.identity
    token = challenge.issue_mfa_challenge(
        user_id=ident.user_id, org_id=ident.org_id, org_slug=ident.org_slug,
        role=ident.role, email=ident.email,
    )
    resp = JSONResponse({"mfa_required": True})
    _set_cookie(resp, challenge.MFA_COOKIE_NAME, token, max_age=challenge.MFA_TTL)
    return resp


@app.post("/auth/{slug}/native/login/totp")
def native_login_totp(slug: str, body: TotpLoginBody, request: Request) -> Response:
    """Step 2 of sign-in: verify the authenticator (or a backup) code carried by
    the MFA cookie from step 1, then issue the real session."""
    pending = challenge.read_mfa_challenge(request.cookies.get(challenge.MFA_COOKIE_NAME))
    if not pending or pending.get("org") != slug:
        raise HTTPException(401, "Your sign-in timed out. Please enter your password again.")
    user_id = int(pending["sub"])
    if not native_auth.verify_totp(user_id, body.code):
        audit.record_event("login_denied", org_id=pending.get("org_id"), actor=pending.get("email"),
                            detail={"method": "native", "slug": slug, "reason": "bad_totp"})
        raise HTTPException(401, "That code didn't match. Try again.")
    audit.record_event("login", org_id=pending.get("org_id"), actor=pending.get("email"),
                       detail={"method": "native", "role": pending.get("role")})
    session = sessions.issue_session(
        user_id=user_id, org_id=pending["org_id"], org_slug=pending["org"],
        role=pending["role"], email=pending.get("email"),
    )
    resp = JSONResponse({"ok": True, "org": pending["org"], "role": pending["role"],
                         "email": pending.get("email")})
    _set_cookie(resp, sessions.COOKIE_NAME, session, max_age=sessions.SESSION_TTL)
    resp.delete_cookie(challenge.MFA_COOKIE_NAME, path="/")
    return resp


@app.post("/auth/{slug}/native/reset/request")
def native_reset_request(slug: str, body: ResetRequestBody) -> dict:
    """Begin a password reset. ALWAYS returns the same response whether or not the
    email is a member, so it can't be used to discover who has an account."""
    email = (body.email or "").strip().lower()
    found = native_auth.user_for_reset(slug, email)
    if found:
        user_id, real_email = found
        raw = native_auth.issue_reset(user_id)
        link = f"{LINK_BASE}/reset-password?token={raw}"
        try:
            _send_reset_email(real_email, link)
        except Exception:
            pass  # never leak send success/failure; logged by the mailer
        audit.record_event("password_reset_requested", actor=real_email,
                            detail={"method": "native", "slug": slug})
    return {"ok": True}


@app.get("/auth/native/reset")
def reset_lookup(token: str = Query(...)) -> dict:
    found = native_auth.peek_token(token, "reset")
    if not found:
        return {"valid": False}
    return {"valid": True, "email": found[1]}


@app.post("/auth/native/reset/confirm")
def reset_confirm(body: ResetConfirmBody) -> dict:
    """Set a new password from a reset link, then spend the token. The existing
    authenticator enrolment is unchanged — the next sign-in still needs MFA."""
    found = native_auth.peek_token(body.token, "reset")
    if not found:
        raise HTTPException(400, "This reset link is invalid or has expired.")
    user_id, email = found
    try:
        native_auth.set_password(user_id, body.password, email=email)
    except WeakPasswordError as exc:
        raise HTTPException(400, str(exc)) from exc
    native_auth.consume_token(body.token, "reset")
    audit.record_event("password_reset", actor=email, detail={"method": "native"})
    return {"ok": True}


# --- platform owner (Control Tower) -----------------------------------------

class OwnerLoginBody(BaseModel):
    token: str


@app.post("/auth/owner-login")
def owner_login(body: OwnerLoginBody) -> Response:
    """Sign in the platform owner with the shared passphrase (PLATFORM_OWNER_TOKEN).

    The owner is cross-org and has no membership, so this issues a special
    role='owner' session that only the /api/platform/* endpoints accept.
    """
    expected = os.environ.get("PLATFORM_OWNER_TOKEN") or ""
    if not expected:
        raise HTTPException(503, "Platform owner access is not configured on the server.")
    if not secrets.compare_digest(body.token or "", expected):
        audit.record_event(
            "login_denied", actor="owner", detail={"method": "owner", "reason": "bad_token"}
        )
        raise HTTPException(403, "Invalid owner passphrase.")
    audit.record_event("login", actor="owner", detail={"method": "owner", "role": "owner"})
    session = sessions.issue_session(
        user_id=0, org_id=0, org_slug="", role="owner", email="owner"
    )
    resp = JSONResponse({"ok": True, "role": "owner"})
    _set_cookie(resp, sessions.COOKIE_NAME, session, max_age=sessions.SESSION_TTL)
    return resp


# --- Control Tower API (owner-gated) ----------------------------------------

class ProvisionBody(BaseModel):
    name: str
    slug: str
    admin_email: str
    region: str = "EU"
    # How members sign in: 'entra' (Microsoft SSO) or 'native' (email + password
    # + authenticator). Defaults to 'entra' to match the historical behaviour.
    auth_method: str = "entra"


class ConsentUrlsBody(BaseModel):
    # The mail link is identical for every customer. The sign-in link carries a
    # "this is for <slug>" tag so that when the customer's admin grants consent,
    # the bounce-back from Microsoft lands on /auth/consent-callback and we can
    # record their tenant id against the right workspace — no one types it.
    slug: str | None = None
    # App ids live in server config; the fields below stay (all optional) only as
    # overrides for unusual setups.
    login_client_id: str | None = None
    connector_client_id: str | None = None
    redirect_uri: str | None = None


class SsoBody(BaseModel):
    tenant_id: str
    # The Login app is one shared registration; its id comes from the
    # SSO_CLIENT_ID env by default, so the operator only supplies the tenant id.
    client_id: str | None = None
    redirect_uri: str | None = None
    enabled: bool = True


class MemberBody(BaseModel):
    email: str
    role: str = "consultant"


@app.get("/api/platform/tenants")
def platform_tenants(_owner: dict = Depends(require_owner)) -> dict:
    return {"tenants": service.organizations_overview()}


@app.post("/api/platform/tenants")
def platform_provision(
    body: ProvisionBody, _owner: dict = Depends(require_owner)
) -> dict:
    try:
        summary = provision.create_organization(
            name=body.name.strip(),
            slug=body.slug.strip(),
            admin_email=body.admin_email.strip(),
            region=body.region.strip() or "EU",
            auth_method=(body.auth_method or "entra").strip(),
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return summary


@app.delete("/api/platform/tenants/{slug}")
def platform_delete_tenant(
    slug: str, confirm: str = "", _owner: dict = Depends(require_owner)
) -> dict:
    """Operator erasure of any workspace: drop its tenant DB and wipe personal
    control-plane data, keeping the financial tombstone. The slug must be typed
    back in the ``confirm`` query param (kept off the request body so it survives
    DELETE — some proxies/clients drop DELETE bodies)."""
    slug = (slug or "").strip()
    if (confirm or "").strip() != slug:
        raise HTTPException(400, "Confirmation does not match the workspace slug.")
    try:
        return provision.erase_organization(
            slug, actor=_owner.get("email") or "owner"
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


class PlatformInviteBody(BaseModel):
    # Who to invite. Omit to invite every admin of the org (the usual case right
    # after provisioning, when there's exactly one seeded admin).
    email: str | None = None


@app.post("/api/platform/tenants/{slug}/invite")
def platform_invite(
    slug: str, body: PlatformInviteBody, _owner: dict = Depends(require_owner)
) -> dict:
    """Send a set-up invite to a native-auth org's member(s). Bootstraps the
    first admin after provisioning — provisioning seeds the membership but does
    NOT email a link, and the in-product invite is admin-gated (chicken-and-egg
    for the very first admin). Entra orgs sign in via Microsoft and never need
    this. Each invite is a single-use link to set a password + enrol an
    authenticator."""
    slug = (slug or "").strip()
    if not native_auth.org_uses_native(slug):
        raise HTTPException(
            400, "Invites are only for password-based (native) organizations. "
            "This org uses Microsoft sign-in."
        )
    target = (body.email or "").strip().lower()
    if target:
        recipients = [target]
    else:
        recipients = [m["email"] for m in service.list_members(slug) if m["role"] == "admin"]
    if not recipients:
        raise HTTPException(400, "No admin to invite — add a member to this org first.")

    org_name = next(
        (o["name"] for o in service.organizations_overview() if o["slug"] == slug), slug
    )
    sent: list[str] = []
    for email in recipients:
        row = service.lookup_member_by_email(slug, email)
        if not row:
            raise HTTPException(400, f"{email!r} is not a member of {slug!r}.")
        raw = native_auth.issue_invite(row[2])
        link = f"{LINK_BASE}/accept-invite?token={raw}"
        try:
            _send_invite_email(email, org_name, link)
        except Exception as exc:  # surface a send failure rather than silently dropping it
            raise HTTPException(502, f"Invite for {email} failed to send: {exc}") from exc
        sent.append(email)

    audit.record_event(
        "platform_invite", org_id=service.org_id_for_slug(slug),
        actor=_owner.get("email") or "owner", detail={"slug": slug, "emails": sent},
    )
    return {"ok": True, "invited": sent, "delivered": mailer.is_configured()}


@app.post("/api/platform/consent-urls")
def platform_consent_urls(
    body: ConsentUrlsBody, _owner: dict = Depends(require_owner)
) -> dict:
    """The two admin-consent links a customer's Microsoft admin clicks.

    Both apps (sign-in + mail connector) are single shared Indigo Iota
    multi-tenant registrations, so their client ids live in server config and
    are never typed per customer. We build the links against the
    ``/organizations`` authority instead of a specific tenant: whichever admin
    signs in determines which tenant the consent lands in.

    The MAIL link is identical for every customer. The SIGN-IN link carries a
    ``state=<slug>`` tag and a dedicated ``/auth/consent-callback`` return
    address: when the admin grants consent, Microsoft bounces back there with
    ``?tenant=<dir id>`` and we record that tenant id against the workspace —
    so the operator never types it.
    """
    base = APP_BASE_URL.rstrip("/")
    mail_redirect = body.redirect_uri or (base + "/")
    sso_redirect = base + "/auth/consent-callback"
    login_id = (body.login_client_id or os.environ.get("SSO_CLIENT_ID", "")).strip()
    connector_id = (
        body.connector_client_id or os.environ.get("GRAPH_CLIENT_ID", "")
    ).strip()
    slug = (body.slug or "").strip()
    return {
        "login_url": oidc.build_admin_consent_url(
            "organizations", login_id, sso_redirect, state=slug or "login"
        )
        if login_id
        else "",
        "connector_url": oidc.build_admin_consent_url(
            "organizations", connector_id, mail_redirect, state="connector"
        )
        if connector_id
        else "",
        "redirect_uri": mail_redirect,
        "login_configured": bool(login_id),
        "connector_configured": bool(connector_id),
    }


@app.put("/api/platform/tenants/{slug}/sso")
def platform_set_sso(
    slug: str, body: SsoBody, _owner: dict = Depends(require_owner)
) -> dict:
    redirect = body.redirect_uri or (APP_BASE_URL.rstrip("/") + "/auth/callback")
    # The Login app is shared: its id defaults to the SSO_CLIENT_ID env so the
    # operator only supplies the customer's tenant id.
    client_id = (body.client_id or os.environ.get("SSO_CLIENT_ID", "")).strip()
    if not client_id:
        raise HTTPException(
            400,
            "No Login app client id. Set SSO_CLIENT_ID on the server "
            "(or pass client_id explicitly).",
        )
    try:
        org_id = service.set_sso_connection(
            slug,
            tenant_id=body.tenant_id.strip(),
            client_id=client_id,
            redirect_uri=redirect,
            enabled=body.enabled,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"org_id": org_id, "redirect_uri": redirect, "enabled": body.enabled}


@app.get("/api/platform/tenants/{slug}/sso/verify")
def platform_verify_sso(slug: str, _owner: dict = Depends(require_owner)) -> dict:
    sso = service.get_sso_config(slug)
    if not sso:
        return {"ok": False, "error": "No enabled SSO connection. Wire SSO first."}
    cfg, org = sso
    try:
        meta = oidc.discover(cfg.tenant_id)
    except httpx.HTTPError as exc:
        return {
            "ok": False,
            "error": f"Could not reach Microsoft for tenant {cfg.tenant_id}: {exc}",
            "tenant_id": cfg.tenant_id,
        }
    from urllib.parse import urlsplit

    app_host = urlsplit(APP_BASE_URL).netloc
    redir_host = urlsplit(cfg.redirect_uri).netloc
    return {
        "ok": True,
        "tenant_id": cfg.tenant_id,
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "issuer": meta.get("issuer"),
        "redirect_host_matches": (not app_host or not redir_host or app_host == redir_host),
        "login_url": f"{APP_BASE_URL.rstrip('/')}/auth/{org.slug}/login",
    }


@app.get("/api/platform/tenants/{slug}/members")
def platform_list_members(slug: str, _owner: dict = Depends(require_owner)) -> dict:
    return {"members": service.list_members(slug)}


@app.post("/api/platform/tenants/{slug}/members")
def platform_add_member(
    slug: str, body: MemberBody, _owner: dict = Depends(require_owner)
) -> dict:
    try:
        added = service.add_member(slug, body.email, body.role, actor="owner")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"member": added, "members": service.list_members(slug)}


@app.get("/api/platform/connector-status")
def platform_connector_status(_owner: dict = Depends(require_owner)) -> dict:
    """Read-only status of the connector's deploy-env credentials. Never returns
    secret values — these live in .env and are set at deploy time, not here.
    """
    tenant_id = os.environ.get("GRAPH_TENANT_ID", "")
    client_id = os.environ.get("GRAPH_CLIENT_ID", "")
    has_secret = bool(os.environ.get("GRAPH_CLIENT_SECRET"))
    has_cert = bool(
        os.environ.get("GRAPH_CLIENT_CERT_PATH")
        and os.environ.get("GRAPH_CLIENT_KEY_PATH")
    )
    auth_mode = "certificate" if has_cert else "secret" if has_secret else "none"
    return {
        "tenant_id": tenant_id,
        "client_id": client_id,
        "auth_mode": auth_mode,
        "ready": bool(tenant_id and client_id and (has_secret or has_cert)),
    }


# --- Control Tower: read-only database browser ------------------------------

@app.get("/api/platform/db/databases")
def platform_db_databases(_owner: dict = Depends(require_owner)) -> dict:
    return {"databases": inspector.list_databases()}


@app.get("/api/platform/db/tables")
def platform_db_tables(
    database: str = Query(...), _owner: dict = Depends(require_owner)
) -> dict:
    try:
        return {"tables": inspector.list_tables(database)}
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/platform/db/rows")
def platform_db_rows(
    database: str = Query(...),
    table: str = Query(...),
    limit: int = Query(50, ge=1, le=inspector.MAX_LIMIT),
    offset: int = Query(0, ge=0),
    sort: str | None = Query(None),
    dir: str = Query("asc"),
    q: str | None = Query(None),
    _owner: dict = Depends(require_owner),
) -> dict:
    try:
        return inspector.get_rows(
            database,
            table,
            limit=limit,
            offset=offset,
            sort_column=sort,
            sort_dir=dir,
            filter_q=q,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/platform/db/export")
def platform_db_export(
    database: str = Query(...),
    table: str = Query(...),
    format: str = Query("csv"),
    sort: str | None = Query(None),
    dir: str = Query("asc"),
    q: str | None = Query(None),
    _owner: dict = Depends(require_owner),
) -> Response:
    """Download a table as CSV or XLSX for offline analytics.

    Honours the same sort/filter as the browser so you can download exactly the
    view you've narrowed to. Secrets stay masked; the row count is capped at
    inspector.MAX_EXPORT_ROWS.
    """
    try:
        content, media_type, filename = inspector.export_table(
            database, table, format, sort_column=sort, sort_dir=dir, filter_q=q
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- internal codebase explainer (owner-only static docs) -------------------
# The docs/explainer/ static site is internal ("never shipped to customers") and
# maps the whole repo file-by-file, so it must NOT be public. We serve it through
# this owner-gated route instead of the frontend's public assets, and embed it in
# the Control Tower Guide tab. Relative links inside the pages resolve under this
# same prefix, so the multi-page site + its css/js/img all work.
_EXPLAINER_DIR = (Path(__file__).resolve().parents[3] / "docs" / "explainer").resolve()


@app.get("/api/platform/explainer")
@app.get("/api/platform/explainer/{path:path}")
def platform_explainer(
    path: str = "index.html", _owner: dict = Depends(require_owner)
) -> Response:
    target = (_EXPLAINER_DIR / (path or "index.html")).resolve()
    try:
        target.relative_to(_EXPLAINER_DIR)  # block path traversal
    except ValueError:
        raise HTTPException(404, "Not found.")
    if not target.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(target)


# --- remote MCP mount (must be last) ----------------------------------------
# The MCP Streamable-HTTP app serves exactly one route, /mcp (plus its OAuth
# protected-resource metadata at /.well-known/oauth-protected-resource/mcp).
# Mounted at root and added AFTER all API routes so it never shadows them; any
# path the API doesn't define falls through to this sub-app (which only answers
# /mcp and its metadata, else 404). Mounting at root — rather than at "/mcp" —
# avoids the trailing-slash 307 that a Mount("/mcp") would force on clients.
app.mount("/", mcp_server.mcp.streamable_http_app())
