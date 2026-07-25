"""Compute a member's Delivery pool: the to-dos they must act on in the next 24h.

Resolves a logged-in user's email to their entity in the brain (a person page, or
the workspace principal as a fallback), assembles that entity's recent context
from the brain (description + dated timeline + relationships + 1-hop neighbours),
and runs the DeliveryAgent over it. The result is a normalized list of to-dos the
Delivery tab renders and caches (see db/delivery_store + the scheduler's 3h job).

A "usual brain inference" — no new storage in the brain itself; to-dos are an LLM
judgment over what the brain already knows about that person.
"""
from __future__ import annotations

from datetime import date

import psycopg

from src import qa
from src.db import brain_pages as brain_pages_repo
from src.db import delivery_store
from src.ingestion.comprehend.agents.delivery import DeliveryAgent
from src.ingestion.comprehend.canonicalize import is_personal_address, normalize_email

# How much neighbour context + how many timeline entries to feed the agent.
_MAX_NEIGHBORS = 8
_MAX_TIMELINE = 25
_VALID_URGENCY = ("critical", "soon", "today")


def _resolve_user_page(conn: psycopg.Connection, email: str) -> dict | None:
    """Find the brain page for this user: a person page whose frontmatter email
    matches, else the workspace principal. None if neither resolves."""
    norm = normalize_email(email)
    if norm and is_personal_address(norm):
        for page in brain_pages_repo.list_pages(conn, entity_type="person"):
            fm = (page.get("data") or {}).get("frontmatter") or {}
            if normalize_email(fm.get("email")) == norm:
                return page
    return brain_pages_repo.get_principal(conn)


def _entity_id_for_page(conn: psycopg.Connection, page_path: str) -> int | None:
    with conn.cursor() as cur:
        cur.execute("SELECT id FROM entities WHERE page_path = %s;", (page_path,))
        row = cur.fetchone()
    return row[0] if row else None


def _assemble_context(data: dict, neighbors: list[dict]) -> str:
    """Render the entity's brain page + neighbour notes into one text block."""
    fm = data.get("frontmatter") or {}
    lines: list[str] = []
    if data.get("description"):
        lines.append(f"Summary: {data['description']}")
    rels = data.get("relationships") or []
    if rels:
        lines.append("Relationships:")
        lines += [f"  - {r.get('predicate')} {r.get('object')}" for r in rels[:20]]
    timeline = data.get("timeline") or []
    if timeline:
        lines.append("Recent timeline (date: event):")
        for e in timeline[-_MAX_TIMELINE:]:
            lines.append(f"  - {e.get('date', '')}: {e.get('entry', '')}")
    if neighbors:
        lines.append("Related people/companies and how they connect:")
        for n in neighbors:
            rel = f" ({n.get('related_to')} {n.get('predicate')} {n.get('entity_name')})" if n.get("predicate") else ""
            note = f" — {n['text']}" if n.get("text") else ""
            lines.append(f"  - {n.get('entity_name')}{rel}{note}")
    _ = fm  # frontmatter currently informational only
    return "\n".join(lines).strip()


# At most this many proactive suggestions are surfaced when nothing is strictly due.
_MAX_SUGGESTIONS = 3


def _onboarding_suggestions() -> list[dict]:
    """Fallback next steps when the brain has no content yet, so the Delivery tab
    is never blank — it points the user at getting value instead."""
    raw = [
        {
            "title": "Connect a mailbox or Drive folder",
            "context": "Your brain has no content yet — connect a source so Indigo Iota can surface real work.",
            "source": "setup",
            "suggested_ask": "Walk me through connecting my first source in the Sources tab.",
        },
        {
            "title": "Add your key clients and projects",
            "context": "Seed the people, companies, and projects you work with so the brain has anchors to reason about.",
            "source": "setup",
            "suggested_ask": "Help me add my main clients and projects as starter entities.",
        },
        {
            "title": "Ask your brain a question",
            "context": "See what's already captured by asking in the Ask tab.",
            "source": "setup",
            "suggested_ask": "Summarise what you currently know about my workspace.",
        },
    ]
    return [s for s in (_normalize_suggestion(r, i) for i, r in enumerate(raw)) if s]


def _normalize_todo(raw: dict, idx: int) -> dict | None:
    """Coerce one agent-produced to-do into the shape the frontend expects."""
    if not isinstance(raw, dict):
        return None
    title = (raw.get("title") or "").strip()
    if not title:
        return None
    try:
        due = int(raw.get("due_in_hours"))
    except (TypeError, ValueError):
        due = 24
    due = max(0, min(24, due))
    urgency = raw.get("urgency")
    if urgency not in _VALID_URGENCY:
        urgency = "critical" if due < 3 else "soon" if due < 8 else "today"
    return {
        "id": str(idx),
        "title": title,
        "context": (raw.get("context") or "").strip(),
        "source": (raw.get("source") or "").strip(),
        "due_in_hours": due,
        "urgency": urgency,
        "suggested_ask": (raw.get("suggested_ask") or "").strip(),
    }


def _normalize_suggestion(raw: dict, idx: int) -> dict | None:
    """Coerce one proactive next-step suggestion (no due/urgency)."""
    if not isinstance(raw, dict):
        return None
    title = (raw.get("title") or "").strip()
    if not title:
        return None
    return {
        "id": f"s{idx}",
        "title": title,
        "context": (raw.get("context") or "").strip(),
        "source": (raw.get("source") or "").strip(),
        "suggested_ask": (raw.get("suggested_ask") or "").strip(),
    }


def _brain_entities(conn: psycopg.Connection, limit: int = 24) -> list[dict]:
    """The workspace's entities as {name, type, desc, timeline, relationships},
    richest-first so the agent reasons over entities that actually have substance
    (description / activity / links) rather than bare names. Raw material for both
    the agent's context and the hard-pad fallback."""
    rows: list[dict] = []
    for p in brain_pages_repo.list_pages(conn):
        data = p.get("data") or {}
        fm = data.get("frontmatter") or {}
        name = fm.get("name") or p.get("page_path")
        if not name:
            continue
        rows.append({
            "name": name,
            "type": p.get("entity_type") or "entity",
            "desc": (data.get("description") or "").strip(),
            "timeline": data.get("timeline") or [],
            "relationships": data.get("relationships") or [],
        })
    # Substance score: prefer entities with a description, recent activity, links.
    def score(e: dict) -> int:
        return (
            (2 if e["desc"] else 0)
            + min(len(e["timeline"]), 5)
            + min(len(e["relationships"]), 3)
        )
    rows.sort(key=score, reverse=True)
    return rows[:limit]


def _workspace_context(conn: psycopg.Connection, entities: list[dict] | None = None) -> str:
    """A brain-wide context block: each entity with its description, recent dated
    timeline, and key relationships — so the agent can reason about concrete,
    specific next steps, not generic ones. Non-empty whenever the brain has pages."""
    ents = entities if entities is not None else _brain_entities(conn)
    if not ents:
        return ""
    lines = ["Entities, recent activity, and relationships in this workspace:"]
    for e in ents:
        head = f"- {e['name']} ({e['type']})"
        if e["desc"]:
            head += f": {e['desc']}"
        lines.append(head)
        for ev in e["timeline"][-5:]:
            lines.append(f"    · {ev.get('date', '')}: {ev.get('entry', '')}")
        for r in e["relationships"][:5]:
            lines.append(f"    → {r.get('predicate')} {r.get('object')}")
    return "\n".join(lines).strip()


def dismiss_key(title: str) -> str:
    """The stable key an item is dismissed/excluded by (normalized title)."""
    return (title or "").strip().lower()


def record_completion(conn: psycopg.Connection, email: str, title: str) -> bool:
    """Write a completed delivery task back into the brain as a dated, self-
    reported timeline entry on the acting member's page, then re-index it so
    Q&A and future agenda inference can see it. Returns True if a page was
    written, False if the user couldn't be resolved to a page or ``title`` was
    blank. Idempotent: re-completing the same task on the same day is a no-op
    (``append_timeline`` skips exact duplicates).

    The entry is tagged ``source="delivery"`` so it stays distinguishable from
    facts observed in email/documents — a self-reported status, not an
    independently verified event.
    """
    title = (title or "").strip()
    page = _resolve_user_page(conn, email)
    if not page or not title:
        return False

    # Local imports: graph_sync pulls the embedding stack lazily, so keep it off
    # the module import path (delivery is imported by the API on every request).
    from src.db.ontology import load_ontology
    from src.ingestion.comprehend.page import BrainPage
    from src.ingestion.index.graph_sync import sync_page_to_graph

    bp = BrainPage.from_row(page["data"], page["page_path"])
    bp.append_timeline(date.today().isoformat(), f"Completed: {title}", source="delivery")
    brain_pages_repo.save_page(conn, page["page_path"], page["entity_type"], bp.data)
    # Re-chunk + re-embed the page so the new entry is retrievable (writing the
    # page row alone leaves the search index stale).
    sync_page_to_graph(conn, load_ontology(conn), bp)
    return True


def _pad_suggestions(
    suggestions: list[dict], entities: list[dict], dismissed: set[str],
) -> list[dict]:
    """Guarantee up to _MAX_SUGGESTIONS by topping up from real brain entities when
    the model returned fewer — so the tab ALWAYS shows next steps grounded in the
    workspace's actual people/companies/projects. Skips anything already present or
    previously acted on (``dismissed``)."""
    have = {dismiss_key(s.get("title") or "") for s in suggestions}
    idx = len(suggestions)
    for e in entities:
        if len(suggestions) >= _MAX_SUGGESTIONS:
            break
        # Ground the fallback in the entity's actual description / last activity
        # when we have it, instead of a flat "advance work with X".
        last = (e.get("timeline") or [])[-1:]
        hook = (e.get("desc") or "").strip()
        if not hook and last:
            hook = (last[0].get("entry") or "").strip()
        if hook:
            title = f"Follow up on {e['name']}"
            context = hook
            ask = f"Based on what we know about {e['name']} ({hook}), draft the most useful next step."
        else:
            title = f"Reconnect with {e['name']}"
            context = f"{e['name']} is in your workspace but has no recent activity logged."
            ask = f"Draft a check-in to {e['name']} to re-open the conversation."
        k = dismiss_key(title)
        if k in have or k in dismissed:
            continue
        suggestions.append({
            "id": f"s{idx}",
            "title": title,
            "context": context,
            "source": f"{e['type']} · {e['name']}",
            "suggested_ask": ask,
        })
        have.add(k)
        idx += 1
    return suggestions


def compute_pool_for_user(conn: psycopg.Connection, email: str) -> dict:
    """Run the brain inference and return this user's normalized pool.

    Returns ``{"todos": [...], "suggestions": [...]}``. ``todos`` are actions due
    in the next 24h (may be empty); ``suggestions`` are up to 3 proactive next
    steps so the tab is useful even when nothing is strictly due. Falls back to a
    workspace-wide context when the user has no (or a thin) brain page, so
    suggestions still appear whenever the brain has ANY content. Empty only when
    the brain itself is empty — never an error.
    """
    empty = {"todos": [], "suggestions": []}
    dismissed = set(delivery_store.get_dismissed(conn, email))
    page = _resolve_user_page(conn, email)
    data = page.get("data") or {} if page else {}
    fm = data.get("frontmatter") or {}
    name = fm.get("name") or "the team"

    neighbors: list[dict] = []
    if page:
        entity_id = _entity_id_for_page(conn, page["page_path"])
        if entity_id is not None:
            neighbors = qa._expand_via_graph([entity_id], _MAX_NEIGHBORS, conn=conn)

    # Always give the agent the workspace's real entities (plus any per-user
    # detail) so it has material to suggest from — even when the user's own page
    # is thin. If the brain has NO pages at all, fall back to onboarding steps.
    entities = _brain_entities(conn)
    per_user = _assemble_context(data, neighbors) if data else ""
    workspace = _workspace_context(conn, entities)
    context = (per_user + "\n\n" + workspace).strip() if per_user else workspace
    if not context:  # brain genuinely has nothing yet → onboarding next steps
        return {"todos": [], "suggestions": _onboarding_suggestions()}

    result = DeliveryAgent().run(name, date.today().isoformat(), context)

    todos = [_normalize_todo(t, i) for i, t in enumerate(result.get("todos", []))]
    todos = [t for t in todos if t and dismiss_key(t["title"]) not in dismissed]
    todos.sort(key=lambda t: t["due_in_hours"])

    suggestions = [
        _normalize_suggestion(s, i) for i, s in enumerate(result.get("suggestions", []))
    ]
    # Drop anything the user already acted on, so it doesn't keep re-surfacing.
    suggestions = [
        s for s in suggestions if s and dismiss_key(s["title"]) not in dismissed
    ][:_MAX_SUGGESTIONS]
    # Force the full set: if fewer than 3 remain, top up from other (non-dismissed)
    # brain entities so freed slots fill with different next steps.
    if len(suggestions) < _MAX_SUGGESTIONS:
        suggestions = _pad_suggestions(suggestions, entities, dismissed)
    if not suggestions:  # no entities to pad from either
        suggestions = _onboarding_suggestions()

    return {"todos": todos, "suggestions": suggestions}
