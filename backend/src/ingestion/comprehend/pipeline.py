"""
The comprehend orchestrator. For each email it builds/updates the brain pages for
the entities involved and the relationships between them.

Two entry points share one extraction core:
  - ``comprehend_email(ctx)`` — the email path (runner). Runs the envelope-aware
    preamble: amalgamate context → translate subject/body → third-party detection
    → identify → canonicalize → build entity pairs → pairwise relationships →
    per-entity pages.
  - ``process_text(text, date)`` — the raw-text path (reinit corpus, demo
    fixture). No envelope, so it skips direction/third-party and just
    translate → identify → core.

Entity types, attribute fields, and the (preferred) relationship predicates come
from the tenant's ontology. Predicates are OPEN: the RelationshipAgent coins them,
the PredicateNormalizerAgent collapses synonyms onto the house vocabulary.

Cost is admin-tunable via comprehend_settings (the "Diligence" config): the
relationship pairing mode (anchored | capped | exhaustive) and which downstream
agents receive third-party brain-page context (Phase 2).
"""
from __future__ import annotations
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field

from src import events
from src.ingestion.comprehend.page import BrainPage
from src.db import brain_pages as brain_pages_repo
from src.db import entities as entity_repo
from src.db import relationships as relationship_repo
from src.ingestion.comprehend.canonicalize import (
    clean_person_name,
    is_personal_address,
    normalize_email,
)
from src.db.connection import get_connection, get_tenant_connection
from src.db.ontology import Ontology, EntityTypeSpec, load_ontology
from src.ingestion.capture.clean import html_to_text
from src.ingestion.comprehend import settings_store
from src.ingestion.comprehend.agents.identifier import IdentifierAgent
from src.ingestion.comprehend.agents.canonicalizer import CanonicalizerAgent
from src.ingestion.comprehend.agents.third_party import ThirdPartyAgent
from src.ingestion.comprehend.agents.attribute import AttributeAgent
from src.ingestion.comprehend.agents.relationship import RelationshipAgent
from src.ingestion.comprehend.agents.predicate_normalizer import (
    PredicateNormalizerAgent,
    slug_predicate,
)
from src.ingestion.comprehend.agents.description import (
    DescriptionWriterAgent, DescriptionUpdaterAgent,
)
from src.ingestion.comprehend.agents.timeline import TimelineAgent
from src.ingestion.comprehend.agents.translator import (
    TranslatorAgent, translate_if_needed,
)
from src.ingestion.index.graph_sync import sync_page_to_graph

# Fan-out caps. The global LLM semaphore (agents/base.py) is the real throttle;
# these just bound how many tasks we queue.
_MAX_ENTITY_WORKERS = 8
_MAX_AGENT_WORKERS = 3   # attribute + description + timeline per entity
_MAX_PAIR_WORKERS = 6

# Diligence: how many entity pairs the RelationshipAgent evaluates per email.
_CAPPED_THRESHOLD = 5    # 'capped' goes full-pairwise only at/below this entity count
_HARD_PAIR_CAP = {"anchored": 60, "capped": 50, "exhaustive": 60}


@dataclass
class EmailContext:
    """The full envelope + content of one email, as the comprehend pipeline needs
    it. Built by the runner from a captured_events row + its capturing mailbox."""
    sender: str | None
    sender_name: str | None
    recipients_to: list[str]
    recipients_cc: list[str]
    subject: str
    body: str
    date: str                      # ISO date (YYYY-MM-DD) or ""
    mailbox: str | None = None     # the mailbox this email was captured from
    label: str = ""

    @property
    def direction(self) -> str:
        """'outbound' when the mailbox owner is the sender, else 'inbound'."""
        s, m = normalize_email(self.sender), normalize_email(self.mailbox)
        return "outbound" if (s and m and s == m) else "inbound"

    @property
    def primary_other_address(self) -> str | None:
        """The third party's address: the sender (inbound) or the first
        recipient (outbound)."""
        if self.direction == "inbound":
            return self.sender
        return (self.recipients_to or self.recipients_cc or [None])[0]


@dataclass
class _EntityOutcome:
    is_new: bool
    entity_id: int | None
    page_path: str | None = None
    relationship_ids: list[int] = field(default_factory=list)


@dataclass
class ComprehendResult:
    """The yield of one comprehend run (per email/text). ``page_refs`` is the
    source-of-truth provenance; ``entity_refs``/``relationship_ids`` are the
    derived graph view; ``debug`` is the per-email trace persisted to
    comprehension_log for the Observability view."""
    entities_found: int = 0
    entities_created: int = 0
    entities_updated: int = 0
    page_refs: list[tuple[str, str]] = field(default_factory=list)
    entity_refs: list[tuple[int, str]] = field(default_factory=list)
    relationship_ids: list[int] = field(default_factory=list)
    debug: dict = field(default_factory=dict)


def _slugify(name: str) -> str:
    """Turn an entity name into a safe filename, e.g. 'Yusuf El-Masri' -> 'yusuf-el-masri'."""
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")


def _dedup_entities(entities: list[dict]) -> list[dict]:
    """Drop duplicate canonical (type, name) entries, carrying an email across
    duplicates so the address signal isn't lost."""
    seen: dict[tuple[str, str], dict] = {}
    out: list[dict] = []
    for e in entities:
        etype, name = e.get("type"), e.get("name")
        if not etype or not name:
            continue
        key = (etype, name)
        if key in seen:
            kept = seen[key]
            if not kept.get("email") and e.get("email"):
                kept["email"] = e["email"]
            continue
        seen[key] = e
        out.append(e)
    return out


class ComprehendPipeline:
    """Holds all the agents and runs the per-email comprehend flow."""

    def __init__(self, db_name: str | None = None):
        self.db_name = db_name
        self.translator = TranslatorAgent()
        self.third_party = ThirdPartyAgent()
        self.identifier = IdentifierAgent()
        self.canonicalizer = CanonicalizerAgent()
        self.attribute = AttributeAgent()
        self.relationship = RelationshipAgent()
        self.predicate_normalizer = PredicateNormalizerAgent()
        self.desc_writer = DescriptionWriterAgent()
        self.desc_updater = DescriptionUpdaterAgent()
        self.timeline = TimelineAgent()
        self._ontology: Ontology | None = None
        self._predicate_registry: set[str] | None = None
        self._settings_cache: dict | None = None
        self._graph_sync_enabled = True

    # --- entry points ----------------------------------------------------

    def run(self, emails: list[dict]) -> None:
        """Demo/fixture path: process a list of Graph email objects, oldest first."""
        ordered = sorted(emails, key=lambda m: m["receivedDateTime"])
        for msg in ordered:
            self._process_email(msg)

    def _process_email(self, msg: dict) -> None:
        text = html_to_text(msg["body"]["content"])
        date = msg["receivedDateTime"]
        label = f"email: {msg['subject']} ({date[:10]})"
        email_id = msg.get("id") or f"{date}|{msg['subject']}"
        events.publish("email_started", {
            "id": email_id,
            "subject": msg.get("subject", ""),
            "from_name": msg["from"]["emailAddress"]["name"],
            "from_address": msg["from"]["emailAddress"]["address"],
            "date": date,
            "snippet": text[:600],
        })
        try:
            self.process_text(text, date, label=label)
        finally:
            events.publish("email_completed", {"id": email_id})

    def process_text(
        self, text: str, date: str, label: str = "",
        sender: str | None = None, sender_name: str | None = None,
        participants: list | None = None,
    ) -> ComprehendResult:
        """Raw-text entry (reinit corpus, demo). No email envelope, so no
        direction/third-party detection — just translate → identify → core.

        Kept signature-compatible with old callers; ``sender``/``participants``
        are ignored here (the email path uses ``comprehend_email``)."""
        if label:
            print(f"\n--- Processing {label} ---")
        text = translate_if_needed(self.translator, text)
        return self._comprehend(text, date, label=label)

    def comprehend_email(self, ctx: EmailContext) -> ComprehendResult:
        """Email entry: the full envelope-aware flow (steps 0–8)."""
        if ctx.label:
            print(f"\n--- Processing {ctx.label} ({ctx.direction}) ---")
        # 1. Translate subject + body only (headers/addresses stay verbatim).
        subject = translate_if_needed(self.translator, ctx.subject) if ctx.subject else ""
        body = translate_if_needed(self.translator, ctx.body) if ctx.body else ""
        # 0. Amalgamate the full envelope into the text every agent sees.
        amalgamated = self._amalgamate(ctx, subject, body)

        ontology = self._load_ontology()
        # 2. Third-party detection → seed entities + the principal↔3rd-party edges.
        tp_debug: dict = {}
        third_party_entities, seed_edges = self._detect_third_party(
            ctx, subject, body, ontology, tp_debug
        )
        # 3. Brain-context pull (gated per agent). Build the third party's 1-hop
        # neighbour context once if any downstream agent is toggled on.
        settings = self._settings()
        context_agents = settings.get("context_agents", {})
        neighbor_context = None
        if any(context_agents.values()):
            neighbor_context = self._neighbor_context(
                third_party_entities, settings.get("context_max_neighbors", 10)
            )
        return self._comprehend(
            amalgamated, ctx.date, label=ctx.label,
            seed_entities=third_party_entities, anchors=third_party_entities,
            seed_edges=seed_edges,
            debug_extra={"direction": ctx.direction, **tp_debug},
            neighbor_context=neighbor_context, context_agents=context_agents,
        )

    # --- shared core -----------------------------------------------------

    def _comprehend(
        self, text: str, date: str, *, label: str = "",
        seed_entities: list[dict] | None = None,
        anchors: list[dict] | None = None,
        seed_edges: list[tuple] | None = None,
        debug_extra: dict | None = None,
        neighbor_context: str | None = None,
        context_agents: dict | None = None,
    ) -> ComprehendResult:
        """Identify → canonicalize → pair → relationships → per-entity pages.

        ``seed_entities`` (the resolved third party) seed the Identifier and are
        added to the entity set. ``anchors`` (principal + third party) drive
        pairing. ``seed_edges`` are deterministic (subject, predicate, object)
        triples written directly (the principal↔3rd-party + agent_of edges)."""
        seed_entities = seed_entities or []
        anchors = anchors or []
        seed_edges = seed_edges or []
        context_agents = context_agents or {}

        def ctx_for(agent: str) -> str | None:
            return neighbor_context if (neighbor_context and context_agents.get(agent)) else None

        ontology = self._load_ontology()
        self._predicates()  # warm the registry
        known = self._known_entities(ontology)

        found = self.identifier.run(
            text, ontology.entity_types, seed_entities=seed_entities,
            neighbor_context=ctx_for("identifier"),
        )
        found = self.canonicalizer.run(found, known)
        entities = _dedup_entities(list(seed_entities) + found)
        print(f"  identified: {[e['name'] for e in entities]}")

        result = ComprehendResult(entities_found=len(entities))
        if not entities:
            result.debug = self._base_debug(text, entities, [], [], debug_extra)
            return result

        principal = self._principal_candidate()
        anchor_list = _dedup_entities(([principal] if principal else []) + list(anchors))
        # Count the workspace principal in the footprint: every in-scope email
        # links its third party TO the principal, so it genuinely touches both.
        # Dedup so an email FROM the principal (third party == principal) stays 1.
        result.entities_found = len(
            _dedup_entities(entities + ([principal] if principal else []))
        )
        mode = self._settings().get("relationship_diligence", "anchored")
        pairs = self._build_pairs(entities, anchor_list, mode)

        # Step 7: infer relationships pair-by-pair, normalize → group by subject.
        rels_by_subject, pair_debug = self._infer_relationships(
            pairs, text, ontology, neighbor_context=ctx_for("relationship")
        )

        # Per-content-agent context (each toggled independently).
        content_ctx = {
            "attribute": ctx_for("attribute"),
            "description": ctx_for("description"),
            "timeline": ctx_for("timeline"),
        }

        # Step 8: build/update each entity's page (content agents) and attach its
        # precomputed relationships, in parallel across entities.
        with ThreadPoolExecutor(max_workers=_MAX_ENTITY_WORKERS) as pool:
            futures = {
                pool.submit(
                    self._handle_entity, e, text, date, ontology,
                    rels_by_subject.get(e["name"], []), content_ctx,
                ): e
                for e in entities
            }
            for fut in as_completed(futures):
                entity = futures[fut]
                try:
                    outcome = fut.result()
                except Exception as exc:
                    print(f"  WARNING: entity {entity.get('name')!r} failed: {exc!r}")
                    continue
                if outcome.is_new:
                    result.entities_created += 1
                else:
                    result.entities_updated += 1
                action = "created" if outcome.is_new else "updated"
                if outcome.page_path is not None:
                    result.page_refs.append((outcome.page_path, action))
                if outcome.entity_id is not None:
                    result.entity_refs.append((outcome.entity_id, action))
                result.relationship_ids.extend(outcome.relationship_ids)

        # Resolve "always-connected" markers (predicate=None) into substantive
        # edges: reuse the pairwise result when it already linked the pair, else
        # force one substantive inference. Then write all structural edges.
        resolved_edges = self._resolve_forced_edges(
            seed_edges, rels_by_subject, text, ontology
        )
        edge_rids, edge_debug = self._write_edges(resolved_edges)
        result.relationship_ids.extend(edge_rids)

        result.debug = self._base_debug(text, entities, edge_debug, pair_debug, debug_extra)
        return result

    def _base_debug(self, text, entities, edge_debug, pair_debug, debug_extra) -> dict:
        d = {
            "email_text": text[:4000],
            "entities": [
                {"type": e.get("type"), "name": e.get("name"), "email": e.get("email")}
                for e in entities
            ],
            "structural_edges": edge_debug,
            "pairs": pair_debug,
        }
        if debug_extra:
            d.update(debug_extra)
        return d

    # --- step 0: amalgamate ---------------------------------------------

    @staticmethod
    def _amalgamate(ctx: EmailContext, subject: str, body: str) -> str:
        """Render the full envelope + content as a compact block the agents read."""
        from_label = (ctx.sender_name or "").strip() or clean_person_name(ctx.sender or "")
        from_line = from_label + (f" <{ctx.sender}>" if ctx.sender else "")
        lines = [f"Direction: {ctx.direction}"]
        if from_line.strip():
            lines.append(f"From: {from_line}")
        if ctx.recipients_to:
            lines.append(f"To: {', '.join(ctx.recipients_to)}")
        if ctx.recipients_cc:
            lines.append(f"Cc: {', '.join(ctx.recipients_cc)}")
        if ctx.date:
            lines.append(f"Date: {ctx.date}")
        if subject:
            lines.append(f"Subject: {subject}")
        return ("\n".join(lines) + "\n\n" + (body or "")).strip()

    # --- step 2: third-party detection ----------------------------------

    def _detect_third_party(
        self, ctx: EmailContext, subject: str, body: str, ontology: Ontology,
        debug: dict,
    ) -> tuple[list[dict], list[tuple]]:
        """Classify the third party and return (entities, seed_edges).

        entities: the third-party person and/or company (canonicalized). seed_edges:
        deterministic (subject, predicate, object) triples — principal
        ``communicated_with`` the primary third party, and (agent case) person
        ``works_at`` company."""
        addr = ctx.primary_other_address
        if not addr:
            return [], []
        # Inbound carries the sender's display name; outbound recipients don't.
        display = ctx.sender_name if ctx.direction == "inbound" else None
        cls = self.third_party.run(
            direction=ctx.direction, address=addr, display_name=display,
            subject=subject, body=body, debug=debug,
        )

        person_spec = ontology.entity_type("person")
        company_spec = ontology.entity_type("company")
        known = self._known_entities(ontology)

        entities: list[dict] = []
        person = None
        company = None
        if cls.get("person_name") and person_spec is not None:
            raw = {"type": person_spec.key, "name": cls["person_name"]}
            if is_personal_address(addr):
                raw["email"] = addr
            person = self.canonicalizer.run([raw], known)[0]
            entities.append(person)
        if cls.get("company_name") and company_spec is not None:
            raw = {"type": company_spec.key, "name": cls["company_name"]}
            company = self.canonicalizer.run([raw], known)[0]
            entities.append(company)

        primary = person or company  # the principal's counterpart on this email
        seed_edges: list[tuple] = []
        principal = self._principal_candidate()
        if principal and primary:
            # The principal and their counterpart are always connected, but the
            # edge must carry a SUBSTANTIVE predicate — never a lazy
            # "communicated_with". A None predicate marks this pair for the
            # forced relationship inference in _comprehend (which reuses the
            # pairwise result when it already found one, else forces a single
            # substantive call). See _resolve_forced_edges.
            seed_edges.append((principal, None, primary))
        if person and company:
            seed_edges.append((person, "works_at", company))
        return _dedup_entities(entities), seed_edges

    # --- step 6: build entity pairs -------------------------------------

    def _build_pairs(
        self, entities: list[dict], anchors: list[dict], mode: str
    ) -> list[tuple[dict, dict]]:
        """Unordered {A,B} pairs to evaluate, per the diligence mode.

        anchored: each anchor × every entity (+ anchor↔anchor). capped: full
        pairwise when small, else anchored. exhaustive: full pairwise. With no
        anchors (raw text) we fall back to full pairwise so relationships aren't
        lost. A hard cap bounds worst-case cost."""
        pool: dict[str, dict] = {}
        for e in list(anchors) + list(entities):
            n = e.get("name")
            if n and n not in pool:
                pool[n] = {"type": e.get("type"), "name": n}
        items = list(pool.values())
        anchor_names = {a["name"] for a in anchors if a.get("name")}

        seen: set[tuple[str, str]] = set()
        pairs: list[tuple[dict, dict]] = []

        def add(x: dict, y: dict) -> None:
            if x["name"] == y["name"]:
                return
            key = tuple(sorted([x["name"], y["name"]]))
            if key in seen:
                return
            seen.add(key)
            pairs.append((x, y))

        n = len(items)
        full = (
            mode == "exhaustive"
            or (mode == "capped" and n <= _CAPPED_THRESHOLD)
            or not anchor_names
        )
        if full:
            for i in range(n):
                for j in range(i + 1, n):
                    add(items[i], items[j])
        else:  # anchored
            anchor_items = [it for it in items if it["name"] in anchor_names]
            for a in anchor_items:
                for it in items:
                    add(a, it)
        return pairs[: _HARD_PAIR_CAP.get(mode, 60)]

    # --- step 7: pairwise relationship inference ------------------------

    def _infer_relationships(
        self, pairs: list[tuple[dict, dict]], text: str, ontology: Ontology,
        neighbor_context: str | None = None,
    ) -> tuple[dict[str, list[dict]], list[dict]]:
        """Evaluate each pair (parallel), then normalize predicates (serial) and
        group accepted triples by subject name. Returns (rels_by_subject, debug)."""
        preferred = [
            f"{rt.key} — {rt.description}" if rt.description else rt.key
            for rt in ontology.relationship_types
        ]
        accepted: list[dict] = []
        pair_debug: list[dict] = []
        if pairs:
            with ThreadPoolExecutor(max_workers=_MAX_PAIR_WORKERS) as pool:
                futs = {
                    pool.submit(self._one_pair, a, b, text, preferred, neighbor_context): (a, b)
                    for (a, b) in pairs
                }
                for fut in as_completed(futs):
                    a, b = futs[fut]
                    try:
                        triple, dbg = fut.result()
                    except Exception as exc:
                        print(f"  WARNING: pair "
                              f"{a.get('name')!r}/{b.get('name')!r} failed: {exc!r}")
                        continue
                    pair_debug.append(dbg)
                    if triple:
                        accepted.append(triple)

        # Normalize serially — the registry + agent cache aren't thread-safe.
        registry = self._predicates()
        rels_by_subject: dict[str, list[dict]] = {}
        for tr in accepted:
            canon = self.predicate_normalizer.run(tr["predicate"], registry)
            if not canon:
                continue
            registry.add(canon)
            rels_by_subject.setdefault(tr["subject"], []).append({
                "predicate": canon,
                "object": tr["object"],
                "object_type": tr["object_type"],
            })
        return rels_by_subject, pair_debug

    def _one_pair(
        self, a: dict, b: dict, text: str, preferred: list[str],
        neighbor_context: str | None = None,
    ):
        dbg: dict = {"pair": [a.get("name"), b.get("name")]}
        triple = self.relationship.run(
            text, a, b, preferred_predicates=preferred,
            neighbor_context=neighbor_context, debug=dbg,
        )
        dbg["result"] = triple or None
        return triple, dbg

    # --- always-connected edges (substantive, never "communicated_with") -

    def _resolve_forced_edges(
        self, seed_edges: list[tuple], rels_by_subject: dict[str, list[dict]],
        text: str, ontology: Ontology,
    ) -> list[tuple]:
        """Turn ``(subject, None, object)`` markers into concrete substantive edges.

        These pairs are known to be connected (principal ↔ their counterpart), so
        the edge must always exist — but with a meaningful predicate, never a lazy
        ``communicated_with``. If the pairwise pass already linked the pair (either
        direction), we keep that and drop the marker (no duplicate, no extra LLM
        call). Otherwise we force ONE substantive inference for the pair. Concrete
        seed edges (predicate set) pass through untouched.
        """
        resolved: list[tuple] = []
        preferred = [
            f"{rt.key} — {rt.description}" if rt.description else rt.key
            for rt in ontology.relationship_types
        ]
        for subj, predicate, obj in seed_edges:
            if predicate is not None:
                resolved.append((subj, predicate, obj))
                continue
            if not (subj and obj and subj.get("name") and obj.get("name")):
                continue
            if self._already_linked(rels_by_subject, subj["name"], obj["name"]):
                continue  # the pairwise pass already gave this pair a real edge
            triple = self.relationship.run(
                text, subj, obj, preferred_predicates=preferred, force=True,
            )
            pred = (triple or {}).get("predicate")
            if not pred:
                continue
            # Normalize the coined predicate to house vocabulary, as the pairwise
            # path does, so the forced edge stays consistent with the rest.
            registry = self._predicates()
            canon = self.predicate_normalizer.run(pred, registry) or pred
            registry.add(canon)
            # Orient by the names the agent chose (subj/obj may be swapped).
            by_name = {subj["name"]: subj, obj["name"]: obj}
            s = by_name.get(triple.get("subject"), subj)
            o = by_name.get(triple.get("object"), obj)
            resolved.append((s, canon, o))
        return resolved

    @staticmethod
    def _already_linked(
        rels_by_subject: dict[str, list[dict]], n1: str, n2: str
    ) -> bool:
        """Did the pairwise pass link n1↔n2 in either direction?"""
        for subj, rels in rels_by_subject.items():
            for r in rels:
                o = r.get("object")
                if (subj == n1 and o == n2) or (subj == n2 and o == n1):
                    return True
        return False

    # --- deterministic edges --------------------------------------------

    def _write_edges(self, edges: list[tuple]) -> tuple[list[int], list[dict]]:
        """Write a list of (subject_entity, predicate, object_entity) triples
        directly to the graph (resolving each endpoint). Idempotent; self-loops
        skipped. Returns (relationship_ids, debug)."""
        rids: list[int] = []
        debug: list[dict] = []
        if not edges:
            return rids, debug
        with self._open_conn() as conn:
            for subj, predicate, obj in edges:
                if not (subj and obj and subj.get("name") and obj.get("name")):
                    continue
                sid = entity_repo.resolve_entity(conn, subj["type"], subj["name"])
                oid = entity_repo.resolve_entity(conn, obj["type"], obj["name"])
                if sid == oid:
                    continue
                rid = relationship_repo.add_relationship(conn, sid, predicate, oid, None)
                if rid is not None:
                    rids.append(rid)
                    debug.append({
                        "subject": subj["name"], "predicate": predicate,
                        "object": obj["name"],
                    })
        return rids, debug

    # --- loading / caches ------------------------------------------------

    def _principal_candidate(self) -> dict | None:
        with self._open_conn() as conn:
            p = brain_pages_repo.get_principal(conn)
        if not p:
            return None
        name = (p["data"].get("frontmatter") or {}).get("name")
        if not name:
            return None
        return {"type": p["entity_type"], "name": name}

    def _neighbor_context(self, entities: list[dict], max_n: int) -> str | None:
        """Compact read-only context from the 1-hop neighbours of ``entities``
        (the resolved third party): '- Name (type): description' lines, capped at
        ``max_n`` total. None when no neighbours exist (e.g. a brand-new contact)."""
        if max_n <= 0 or not entities:
            return None
        lines: list[str] = []
        seen: set = set()
        with self._open_conn() as conn:
            for ent in entities:
                if len(lines) >= max_n:
                    break
                eid = entity_repo.find_entity(conn, ent["name"], ent["type"])
                if eid is None:
                    continue
                for nb in entity_repo.get_neighbors(conn, eid, max_n):
                    key = nb.get("page_path") or (nb["type"], nb["name"])
                    if key in seen:
                        continue
                    seen.add(key)
                    desc = ""
                    if nb.get("page_path"):
                        page = brain_pages_repo.load_page(conn, nb["page_path"])
                        if page:
                            desc = (page.get("description") or "").strip()
                    lines.append(
                        f"- {nb['name']} ({nb['type']})" + (f": {desc}" if desc else "")
                    )
                    if len(lines) >= max_n:
                        break
        return "\n".join(lines) if lines else None

    def _settings(self) -> dict:
        """The tenant's comprehend Diligence settings (cached per run). Defensive:
        if the settings table isn't there yet (migration lag), use defaults."""
        if self._settings_cache is None:
            try:
                with self._open_conn() as conn:
                    self._settings_cache = settings_store.get_settings(conn)
            except Exception as exc:
                print(f"  WARNING: comprehend settings unavailable ({exc!r}); using defaults")
                self._settings_cache = {
                    "relationship_diligence": "anchored",
                    "context_agents": {},
                    "context_max_neighbors": 10,
                }
        return self._settings_cache

    def _load_ontology(self) -> Ontology:
        if self._ontology is None:
            with self._open_conn() as conn:
                self._ontology = load_ontology(conn)
        return self._ontology

    def _predicates(self) -> set[str]:
        """Canonical predicate vocabulary, loaded once and grown in-run. Seeded
        from existing relationships AND the tenant's relationship_types (the house
        vocabulary), so open inference collapses synonyms onto them."""
        if self._predicate_registry is None:
            with self._open_conn() as conn, conn.cursor() as cur:
                cur.execute("SELECT DISTINCT predicate FROM relationships;")
                registry = {r[0] for r in cur.fetchall() if r[0]}
            ontology = self._ontology or self._load_ontology()
            for rt in ontology.relationship_types:
                canon = slug_predicate(rt.key)
                if canon:
                    registry.add(canon)
            self._predicate_registry = registry
        return self._predicate_registry

    def _known_entities(self, ontology: Ontology) -> list[dict]:
        """Every stored brain page as [{type, name, email}], for canonicalization."""
        known: list[dict] = []
        with self._open_conn() as conn:
            for row in brain_pages_repo.list_pages(conn):
                fm = row["data"].get("frontmatter") or {}
                name = fm.get("name")
                if name:
                    known.append({
                        "type": row["entity_type"], "name": name,
                        "email": fm.get("email"),
                    })
        return known

    # --- per-entity page build ------------------------------------------

    def _handle_entity(
        self, entity: dict, text: str, date: str, ontology: Ontology,
        relationships: list[dict], content_ctx: dict | None = None,
    ) -> _EntityOutcome:
        """Create/update one entity's page: fill content agents, attach the
        precomputed relationships for this subject, persist + graph-sync."""
        etype, name = entity["type"], entity["name"]
        spec = ontology.entity_type(etype)
        if spec is None:
            return _EntityOutcome(is_new=False, entity_id=None)
        page_path = f"{spec.page_folder}/{_slugify(name)}.json"

        with self._open_conn() as conn:
            existing = brain_pages_repo.load_page(conn, page_path)
        is_new = existing is None
        page = (BrainPage.create(etype, name, page_path, spec.fields) if is_new
                else BrainPage.from_row(existing, page_path))

        mention_email = entity.get("email")
        if mention_email and not (page.data.get("frontmatter") or {}).get("email"):
            page.set_frontmatter("email", mention_email.strip())

        self._fill_content(page, spec, name, text, date, is_new, content_ctx)
        page.set_relationships(relationships)
        print(f"  {'created' if is_new else 'updated'} {etype}: {name}")

        entity_id, relationship_ids = self._persist(page, etype, ontology)
        return _EntityOutcome(
            is_new=is_new, entity_id=entity_id, page_path=page.page_path,
            relationship_ids=relationship_ids,
        )

    def _fill_content(
        self, page, spec: EntityTypeSpec, name, text, date, is_new,
        content_ctx: dict | None = None,
    ) -> None:
        """Run the page-content agents (attributes, description, timeline) in
        parallel and apply them. Relationships are NOT computed here — they're
        inferred pairwise upstream and attached by the caller. ``content_ctx``
        supplies optional per-agent brain-page context."""
        ctx = content_ctx or {}

        def call_attrs():
            return self.attribute.run(
                text, name, spec.label, spec.fields,
                neighbor_context=ctx.get("attribute"),
            )

        if is_new:
            def call_desc():
                return self.desc_writer.run(
                    text, name, spec.label, neighbor_context=ctx.get("description")
                )
        else:
            def call_desc():
                return self.desc_updater.run(
                    text, name, page.data["description"],
                    neighbor_context=ctx.get("description"),
                )

        def call_timeline():
            return self.timeline.run(
                text, name, date, neighbor_context=ctx.get("timeline")
            )

        with ThreadPoolExecutor(max_workers=_MAX_AGENT_WORKERS) as pool:
            f_attrs = pool.submit(call_attrs)
            f_desc = pool.submit(call_desc)
            f_timeline = pool.submit(call_timeline)

        for fkey, value in f_attrs.result().items():
            page.set_frontmatter(fkey, value)
        page.set_description(f_desc.result())
        entry = f_timeline.result()
        page.append_timeline(entry["date"], entry["entry"])

    def _persist(
        self, page, entity_type: str, ontology: Ontology
    ) -> tuple[int | None, list[int]]:
        """Save the page (source of truth), then sync entity/relationships/chunks.
        A sync failure for ONE page is logged and skipped — it never disables
        sync for the rest of the run (one bad page can't zero out the graph)."""
        with self._open_conn() as conn:
            brain_pages_repo.save_page(conn, page.page_path, entity_type, page.data)
            if not self._graph_sync_enabled:
                return None, []
            try:
                return sync_page_to_graph(conn, ontology, page)
            except Exception as exc:
                conn.rollback()
                print(f"  WARNING: graph sync failed for {page.page_path} ({exc!r})")
                return None, []

    def _open_conn(self):
        if self.db_name:
            return get_tenant_connection(self.db_name)
        return get_connection()


def main() -> None:
    """Run the pipeline over the template fixture."""
    from src import config

    fixture = config.FIXTURES_DIR / "sample_delta_response.json"
    emails = json.loads(fixture.read_text())["value"]

    pipeline = ComprehendPipeline()
    pipeline.run(emails)
    print("\nDone. Pages written to the default brain DB.")


if __name__ == "__main__":
    main()
