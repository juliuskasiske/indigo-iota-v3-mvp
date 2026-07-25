"""MCP server exposing a customer's Indigo Iota brain as Claude/ChatGPT tools.

Two ways to run the SAME tools:

  * **Remote (multi-tenant)** — mounted into the FastAPI app at ``/mcp`` and
    reached by claude.ai / ChatGPT over Streamable HTTP. Every request carries a
    bearer token (Phase 1: a personal access token from ``mcp_tokens``; Phase 2:
    an OAuth access token). The token pins ONE workspace + ONE member, so each
    tool reads only that tenant's brain and bills that member.

  * **Local (single-tenant dev)** — ``python -m src.mcp_server`` over stdio, for
    Claude Desktop / Claude Code pointed at the local dev brain (DATABASE_URL).
    There is no bearer in stdio, so the tools fall back to the default brain.

How a tool finds its tenant
---------------------------
``get_access_token()`` returns the verified bearer's principal (our
``IotaAccessToken`` carries ``org_id`` + ``user_id``). ``_brain()`` turns that
into a connection to the right tenant brain DB via the control-plane registry.
No token (stdio) → the default ``get_connection()`` brain.

The tools deliberately return raw chunks + structured graph context, NOT an
LLM-summarised answer — the calling model (Claude/ChatGPT) reasons over them
itself. There is intentionally no server-side "ask"/synthesis tool: that would
spend the workspace's LLM credits on a second model, so all synthesis stays with
the calling client. The tools are read-only.
"""
from __future__ import annotations

import argparse
import contextlib
import os
from typing import Optional

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.settings import (
    AuthSettings,
    ClientRegistrationOptions,
    RevocationOptions,
)
from mcp.server.fastmcp import FastMCP, Image
from mcp.server.transport_security import TransportSecuritySettings

from src.auth import mcp_tokens
from src.auth.mcp_oauth import IotaOAuthProvider
from src.db import brain_pages as brain_pages_repo
from src.db import entities as entity_repo
from src.ingestion.comprehend.canonicalize import (
    canonicalize_against_known,
    clean_person_name,
    is_personal_address,
    normalize_email,
)
from src.db.connection import (
    get_connection,
    get_control_connection,
    get_tenant_connection,
)

# Scope names live in the token module so minting + enforcement agree. The MCP
# is read-only (no credit-spending tools), so only the read scope is grantable.
SCOPE_READ = mcp_tokens.SCOPE_READ


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------
# We are our own OAuth Authorization Server (IotaOAuthProvider). The SDK derives
# the bearer verifier from the provider's load_access_token, which accepts BOTH a
# Phase 1 personal access token and a Phase 2 OAuth access token.

def public_origin() -> str:
    """The public origin Caddy serves this app on — the address Claude / ChatGPT
    actually reach (and where /mcp, /authorize, /token live). It is advertised in
    the OAuth discovery documents, so it MUST be the real domain in production,
    not localhost.

    Resolution order: an explicit ``MCP_ISSUER_URL`` override, else the app's own
    ``APP_BASE_URL`` (already the live domain in prod, http://localhost:8080
    locally), else a last-ditch local default. Deriving from APP_BASE_URL means
    this is correct in prod automatically — it can't silently fall back to
    localhost just because someone forgot to set an MCP-specific variable.
    """
    raw = (
        os.environ.get("MCP_ISSUER_URL")
        or os.environ.get("APP_BASE_URL")
        or "http://localhost:8080"
    )
    return raw.rstrip("/")


# issuer_url is THIS app acting as the OAuth Authorization Server (the SDK serves
# /authorize, /token, /register, /revoke + discovery here); resource_server_url
# is the MCP endpoint, advertised in the protected-resource metadata. Both are
# the public origin; resource just adds the /mcp path.
_ORIGIN = public_origin()
_AUTH_SETTINGS = AuthSettings(
    issuer_url=_ORIGIN,
    resource_server_url=(os.environ.get("MCP_RESOURCE_URL") or f"{_ORIGIN}/mcp").rstrip("/"),
    required_scopes=[SCOPE_READ],
    client_registration_options=ClientRegistrationOptions(
        enabled=True,                                   # Dynamic Client Registration
        valid_scopes=[SCOPE_READ],
        default_scopes=[SCOPE_READ],
    ),
    revocation_options=RevocationOptions(enabled=True),
)


mcp = FastMCP(
    "indigo-iota-brain",
    instructions=(
        "Tools that read your Indigo Iota brain — the knowledge graph built "
        "from your organisation's mail (people, companies, projects, and the "
        "relationships between them). Call `whoami` first to learn who is "
        "connected and which brain entity is 'you' (needed for any 'my'/'me' "
        "question). Then: `search_brain` for natural-language questions; "
        "`get_entity` for the full page on one entity; `list_entities` to "
        "browse; `get_neighbors` to walk relationships; `recent_questions` to "
        "see what was asked before. These tools return raw context — reason over "
        "it yourself to answer. `render_subgraph` returns a PICTURE of an "
        "entity's connections — use it when the user wants to see/visualise a "
        "network rather than read facts."
    ),
    auth_server_provider=IotaOAuthProvider(),
    auth=_AUTH_SETTINGS,
    stateless_http=True,         # each request self-contained → safe to mount + scale
    streamable_http_path="/mcp",  # exact path so the app, mounted at root, needs no slash-redirect
    # We sit behind Caddy (which sets the real Host) and every request is bearer
    # authenticated, so the SDK's localhost-only DNS-rebinding guard (which would
    # otherwise reject the production Host header) is turned off deliberately.
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)


# ---------------------------------------------------------------------------
# Tenant resolution
# ---------------------------------------------------------------------------

class _BrainUnavailable(Exception):
    """Raised when an authenticated org has no active brain database."""


def _resolve_db(org_id: Optional[int]) -> Optional[str]:
    """The org's active brain database name from the control-plane registry."""
    if org_id is None:
        return None
    with get_control_connection() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT db_name FROM tenant_databases "
            "WHERE org_id = %s AND status = 'active' "
            "ORDER BY db_name LIMIT 1;",
            (org_id,),
        )
        row = cur.fetchone()
    return row[0] if row else None


@contextlib.contextmanager
def _brain():
    """Yield ``(conn, principal)`` for the caller's tenant brain.

    Remote: ``principal`` is the verified bearer; the connection targets that
    org's brain DB. Local/stdio: no bearer, so ``principal`` is None and the
    connection is the default dev brain. Raises ``_BrainUnavailable`` if an
    authenticated org has no provisioned brain yet.
    """
    principal = get_access_token()
    if principal is None:
        conn = get_connection()
    else:
        db_name = _resolve_db(getattr(principal, "org_id", None))
        if not db_name:
            raise _BrainUnavailable("No active brain database for this workspace.")
        conn = get_tenant_connection(db_name)
    try:
        yield conn, principal
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Tools (read-only retrieval)
# ---------------------------------------------------------------------------

@mcp.tool()
def search_brain(query: str, limit: int = 10) -> dict:
    """Hybrid vector + keyword search over the brain.

    Returns ranked chunks (description sections + timeline entries), each
    annotated with the entity it's about, the section it came from, and the
    retrieval score. The default tool for "what do we know about X" or "who has
    worked on Y" questions.

    Args:
        query: The natural-language question or keywords.
        limit: Max number of chunks to return (default 10).
    """
    # Lazy: fastembed loads its ~133MB model on first embed, not at import.
    from src.db import chunks as chunks_repo
    from src.ingestion.index import embeddings

    q_vec = embeddings.embed_one(query)
    if not q_vec:
        return {"query": query, "count": 0, "results": []}
    try:
        with _brain() as (conn, _principal):
            results = chunks_repo.hybrid_search(query, q_vec, limit=limit, conn=conn)
    except _BrainUnavailable as exc:
        return {"error": str(exc)}
    return {"query": query, "count": len(results), "results": results}


@mcp.tool()
def get_entity(name: str, entity_type: str) -> dict:
    """Fetch the full brain page for an entity.

    Returns the page's frontmatter (structured attributes), description
    (compiled summary), and timeline (dated activity log).

    Args:
        name: Entity name (e.g., "Felix Kasiske").
        entity_type: One of 'person', 'company', 'project'.
    """
    if entity_type not in ("person", "company", "project"):
        return {
            "error": f"invalid entity_type {entity_type!r}; "
                     f"must be 'person', 'company', or 'project'"
        }
    folder = {
        "person": "persons", "company": "companies", "project": "projects",
    }[entity_type]
    slug = "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")
    page_path = f"{folder}/{slug}.json"
    try:
        with _brain() as (conn, _principal):
            data = brain_pages_repo.load_page(conn, page_path)
    except _BrainUnavailable as exc:
        return {"error": str(exc)}
    if data is None:
        return {"error": f"no brain page for {entity_type} {name!r}"}
    return data


@mcp.tool()
def list_entities(entity_type: Optional[str] = None) -> dict:
    """List entities in the brain, optionally filtered by type.

    Returns id, type, name, and page_path for each entity. page_path is None for
    entities that exist only as references from other entities' frontmatter.

    Args:
        entity_type: Optional filter — 'person', 'company', or 'project'.
    """
    try:
        with _brain() as (conn, _principal):
            with conn.cursor() as cur:
                if entity_type:
                    cur.execute(
                        "SELECT id, type, name, page_path FROM entities "
                        "WHERE type = %s ORDER BY name;",
                        (entity_type,),
                    )
                else:
                    cur.execute(
                        "SELECT id, type, name, page_path FROM entities "
                        "ORDER BY type, name;"
                    )
                entities = [
                    {"id": r[0], "type": r[1], "name": r[2], "page_path": r[3]}
                    for r in cur.fetchall()
                ]
    except _BrainUnavailable as exc:
        return {"error": str(exc)}
    return {"count": len(entities), "entities": entities}


@mcp.tool()
def get_neighbors(name: str, entity_type: str) -> dict:
    """Get the 1-hop graph neighbors of an entity.

    Each neighbor entry includes the predicate (works_at, key_contact_at, leads,
    has_client) and the direction relative to the named entity ('out' = entity
    is the subject, 'in' = entity is the object). Use it to surface relationships
    — "who works at X", "what projects does Y lead", "who is the client of Z".

    Args:
        name: Entity name.
        entity_type: 'person', 'company', or 'project'.
    """
    if entity_type not in ("person", "company", "project"):
        return {
            "error": f"invalid entity_type {entity_type!r}; "
                     f"must be 'person', 'company', or 'project'"
        }
    try:
        with _brain() as (conn, _principal):
            entity_id = entity_repo.find_entity(conn, name, entity_type)
            if entity_id is None:
                return {"error": f"no entity for {entity_type} {name!r}"}
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT e.predicate,
                           CASE WHEN e.subject = %s THEN 'out' ELSE 'in' END AS direction,
                           n.id, n.type, n.name, n.page_path
                    FROM relationships e
                    JOIN entities n ON n.id = CASE WHEN e.subject = %s
                                                  THEN e.object
                                                  ELSE e.subject END
                    WHERE e.subject = %s OR e.object = %s
                    ORDER BY e.predicate, n.name;
                    """,
                    (entity_id, entity_id, entity_id, entity_id),
                )
                neighbors = [
                    {
                        "predicate": r[0],
                        "direction": r[1],
                        "neighbor": {
                            "id": r[2], "type": r[3],
                            "name": r[4], "page_path": r[5],
                        },
                    }
                    for r in cur.fetchall()
                ]
    except _BrainUnavailable as exc:
        return {"error": str(exc)}
    return {
        "entity": {"id": entity_id, "type": entity_type, "name": name},
        "count": len(neighbors),
        "neighbors": neighbors,
    }


@mcp.tool()
def recent_questions(limit: int = 20) -> dict:
    """List recent natural-language questions asked of this brain.

    Useful as context: what's been asked before, what topics people care about.

    Args:
        limit: Max number of questions to return (default 20).
    """
    try:
        with _brain() as (conn, _principal):
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id, question, created_at FROM questions "
                    "ORDER BY id DESC LIMIT %s;",
                    (limit,),
                )
                rows = [
                    {
                        "id": r[0],
                        "question": r[1],
                        "created_at": r[2].isoformat() if r[2] else None,
                    }
                    for r in cur.fetchall()
                ]
    except _BrainUnavailable as exc:
        return {"error": str(exc)}
    return {"count": len(rows), "questions": rows}


@mcp.tool()
def whoami() -> dict:
    """Identify the caller: the connected member, and which person in the brain
    that maps to.

    Call this FIRST for any question about "me" / "my" (e.g. "what are MY open
    commitments?", "who have I been talking to?"). The MCP token is bound to one
    member of one workspace; this finds the BEST-MATCHING person in the brain —
    by personal email first (strongest), else by fuzzy name-token overlap on the
    member's display name (or the name derived from their address). People often
    log in with a different address than the one seen in mail, so the match is
    fuzzy, not exact. Then follow up with `get_entity` / `get_neighbors` on the
    returned name. Read-only; spends no credits.

    Returns:
        member: the connected login {email, name} (null in local/stdio dev).
        you: the best-matching person {name, type, page_path, email,
            is_principal}, or null if nothing plausibly matches.
        match: how `you` was chosen — "email" | "name" | null.
        principal: the workspace's centre of gravity {name, type, page_path}.
    """
    token = get_access_token()
    member = None
    if token is not None:
        user_id = getattr(token, "user_id", None)
        if user_id is not None:
            with get_control_connection() as cc, cc.cursor() as cur:
                cur.execute(
                    "SELECT email, display_name FROM users WHERE id = %s;",
                    (user_id,),
                )
                row = cur.fetchone()
            if row:
                member = {"email": row[0], "name": row[1]}

    you = None
    match_kind = None
    try:
        with _brain() as (conn, _principal):
            email = (member or {}).get("email")
            # The name to fuzzy-match on: the member's display name, else a name
            # derived from their login address ('julius@kasiske.de' -> 'Julius').
            raw_name = (member or {}).get("name") or clean_person_name(email or "")
            if member and (email or raw_name):
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT page_path, entity_type, "
                        "       data->'frontmatter'->>'name'  AS name, "
                        "       data->'frontmatter'->>'email' AS email, "
                        "       (data->>'is_principal' = 'true') AS is_principal "
                        "FROM brain_pages WHERE entity_type = 'person';"
                    )
                    people = cur.fetchall()
                known_names = [p[2] for p in people if p[2]]
                known_by_email = {
                    normalize_email(p[3]): p[2]
                    for p in people
                    if p[2] and p[3] and is_personal_address(p[3])
                }
                # Brain's own resolver: personal-email identity first, then
                # token-subset name overlap (most overlap wins, ties → longer name).
                matched = canonicalize_against_known(
                    raw_name, known_names,
                    raw_email=email, known_by_email=known_by_email,
                )
                if matched:
                    row = next((p for p in people if p[2] == matched), None)
                    if row:
                        you = {
                            "name": row[2], "type": row[1], "page_path": row[0],
                            "email": row[3], "is_principal": bool(row[4]),
                        }
                        ne = normalize_email(email)
                        match_kind = (
                            "email" if (ne and known_by_email.get(ne) == matched)
                            else "name"
                        )
            principal_out = None
            p = brain_pages_repo.get_principal(conn)
            if p:
                pfm = p["data"].get("frontmatter") or {}
                principal_out = {
                    "name": pfm.get("name"),
                    "type": p["entity_type"],
                    "page_path": p["page_path"],
                }
    except _BrainUnavailable as exc:
        return {"error": str(exc)}

    note = (
        "You are connected as this member. 'you' is the best-matching person "
        "(see 'match' for how it was found); null means no plausible match — fall "
        "back to 'principal'. Use get_entity / get_neighbors on 'you' or 'principal'."
        if member
        else "No authenticated member (local/stdio dev) — use 'principal' as the anchor."
    )
    return {
        "member": member, "you": you, "match": match_kind,
        "principal": principal_out, "note": note,
    }


# ---------------------------------------------------------------------------
# Tool (visual — renders a picture, still read-only + no LLM credits)
# ---------------------------------------------------------------------------

_TYPE_COLORS = {
    "person": "#22d3ee",   # teal
    "company": "#c084fc",  # purple
    "project": "#818cf8",  # indigo
}
_MAX_NEIGHBORS_DRAWN = 14


def _render_graph_png(center: dict, neighbors: list[dict], message: str | None = None) -> bytes:
    """Draw a 1-hop star: the center entity ringed by its neighbours, edges
    labelled with the (display-name) predicates. Returns PNG bytes. Pure
    server-side drawing — no LLM, no credits. Pillow is already a dependency."""
    import math
    from io import BytesIO
    from PIL import Image as PILImage, ImageDraw, ImageFont

    W, H = 1040, 760
    BG, INK, MUTED, EDGE = "#0f121c", "#e6e8eb", "#9aa3b2", "#5b6472"
    img = PILImage.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_title = ImageFont.load_default(size=22)
    f_node = ImageFont.load_default(size=15)
    f_edge = ImageFont.load_default(size=12)

    def color(t: str) -> str:
        return _TYPE_COLORS.get(t, "#94a3b8")

    def pill(x: float, y: float, text: str, font, fg: str) -> None:
        x0, y0, x1, y1 = d.textbbox((x, y), text, font=font, anchor="mm")
        d.rectangle([x0 - 5, y0 - 2, x1 + 5, y1 + 2], fill="#1b2030")
        d.text((x, y), text, font=font, fill=fg, anchor="mm")

    shown = neighbors[:_MAX_NEIGHBORS_DRAWN]
    extra = len(neighbors) - len(shown)
    title = f"{center.get('name', '?')} · {len(neighbors)} connection{'' if len(neighbors) == 1 else 's'}"
    if extra > 0:
        title += f"  (showing {len(shown)})"
    d.text((26, 22), title, font=f_title, fill=INK)

    cx, cy = W / 2, H / 2 + 24
    R = min(W, H) / 2 - 150
    n = max(1, len(shown))

    # Edges first (behind nodes), then neighbour nodes + labels.
    coords = []
    for i, nb in enumerate(shown):
        ang = -math.pi / 2 + 2 * math.pi * i / n
        nx, ny = cx + R * math.cos(ang), cy + R * math.sin(ang)
        coords.append((nx, ny, nb))
        d.line([(cx, cy), (nx, ny)], fill=EDGE, width=2)
        dirs = nb.get("dirs") or set()
        # ASCII arrows — the default bitmap font lacks the unicode glyphs.
        arrow = "->" if dirs == {"out"} else "<-" if dirs == {"in"} else "<->"
        label = arrow + " " + ", ".join(
            p.replace("_", " ") for p in (nb.get("preds") or [])
        )
        mx, my = cx + (nx - cx) * 0.6, cy + (ny - cy) * 0.6
        pill(mx, my, label[:48], f_edge, "#7dd3fc")

    for nx, ny, nb in coords:
        c = color(nb.get("type", ""))
        d.ellipse([nx - 22, ny - 22, nx + 22, ny + 22], fill=c, outline=BG, width=3)
        pill(nx, ny + 38, (nb.get("name") or "?")[:28], f_node, INK)

    # Center node on top.
    cc = color(center.get("type", ""))
    d.ellipse([cx - 32, cy - 32, cx + 32, cy + 32], fill=cc, outline="#ffffff", width=3)
    pill(cx, cy + 52, (center.get("name") or "?")[:32], f_node, "#ffffff")

    if message:
        d.text((W / 2, H - 40), message, font=f_node, fill=MUTED, anchor="mm")

    buf = BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@mcp.tool()
def render_subgraph(name: str, entity_type: str) -> Image:
    """Draw a PICTURE of one entity's 1-hop neighbourhood (who/what it connects
    to, edges labelled with the relationship).

    Use this when the user wants to SEE / visualise / draw / map an entity's
    connections (e.g. "show me my network", "draw how Acme connects"). For "my"
    questions, resolve the person with `whoami` first, then pass that name here.
    The other tools return text to reason over; this returns an image for the
    human. Read-only; renders server-side, spends no LLM credits.

    Args:
        name: The entity to centre the picture on (exact canonical name).
        entity_type: Its type, e.g. 'person' or 'company'.
    """
    center = {"name": name, "type": entity_type}
    try:
        with _brain() as (conn, _principal):
            eid = entity_repo.find_entity(conn, name, entity_type)
            if eid is None:
                return Image(
                    data=_render_graph_png(center, [], message=f"No {entity_type} named “{name}”."),
                    format="png",
                )
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT r.predicate, "
                    "       CASE WHEN r.subject = %s THEN 'out' ELSE 'in' END AS dir, "
                    "       n.type, n.name "
                    "FROM relationships r "
                    "JOIN entities n ON n.id = "
                    "     CASE WHEN r.subject = %s THEN r.object ELSE r.subject END "
                    "WHERE r.subject = %s OR r.object = %s;",
                    (eid, eid, eid, eid),
                )
                rows = cur.fetchall()
    except _BrainUnavailable as exc:
        return Image(data=_render_graph_png(center, [], message=str(exc)), format="png")

    agg: dict = {}
    for predicate, direction, ntype, nname in rows:
        e = agg.setdefault(
            (nname, ntype), {"name": nname, "type": ntype, "preds": [], "dirs": set()}
        )
        if predicate and predicate not in e["preds"]:
            e["preds"].append(predicate)
        e["dirs"].add(direction)
    neighbors = list(agg.values())
    return Image(
        data=_render_graph_png(
            center, neighbors, message=None if neighbors else "No connections yet."
        ),
        format="png",
    )


# ---------------------------------------------------------------------------
# Entrypoint (stdio for local dev; remote is mounted by the FastAPI app)
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="MCP server for the Indigo Iota brain.")
    parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http", "sse"],
        default="stdio",
        help=(
            "stdio (default) — Claude Desktop / Claude Code against the local "
            "dev brain; streamable-http / sse — standalone remote server (the "
            "FastAPI app already mounts the remote MCP at /mcp in production)."
        ),
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP host")
    parser.add_argument("--port", type=int, default=8765, help="HTTP port")
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run(transport="stdio")
    else:
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        mcp.run(transport=args.transport)


if __name__ == "__main__":
    main()
