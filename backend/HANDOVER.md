# RPX Brain — Project Handover

*Last updated: 2026-05-26 (end of build session adding chunks, search,
website seed, init UI, parallel pipeline, question history, MCP server)*

---

## 1. What this is

A personal/single-tenant **knowledge graph + RAG dashboard** for
RPX Optimization, a maritime/intermodal consultancy. It ingests
unstructured input (a company website, then a fixture of emails),
builds structured "brain pages" about every person/company/project
mentioned, persists a graph (`nodes` + `edges`) and a chunked vector
index, and exposes both a browser dashboard and a Claude MCP connector
on top.

The demo flow is the elevator pitch:

1. Open the dashboard → empty-state form
2. Paste a company URL + name → CI (logo, brand colour, font) auto-fills,
   leadership team appears in the graph live (via SSE)
3. Click "Enrich from emails" → email-derived entities and edges
   stream in on top
4. Use the Search tab to ask natural-language questions, or talk to
   the brain through Claude Desktop via MCP

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | Python **3.12** (managed by **uv**) | MCP SDK requires ≥3.10; system 3.9 is gone |
| LLM | **LLMBase** (OpenAI-compatible), model `openai/gpt-oss-120b` | EU-sovereign, cheap; we deliberately keep agents narrow because the model is unreliable |
| Embeddings | **fastembed** + `BAAI/bge-small-en-v1.5` (384-dim) | Local ONNX runtime, no external API, EU-sovereign. Downloads ~133 MB once |
| Graph + chunks DB | **Postgres** (local via Postgres.app), database `rpx_brain`, **pgvector** + **tsvector** | Standard, well-supported, HNSW index for cosine, GIN for keywords |
| Web framework | **FastAPI** + **uvicorn** | Async-friendly; sync handlers run in a thread pool |
| Frontend | Vanilla JS + **Cytoscape.js** + **cytoscape-fcose** layout + **marked.js** | No build step; CDN loads. fcose gives force-directed auto-spacing |
| Branding | **Montserrat** (Google Fonts) + RPX teal `#105677` | Pulled from rpxoptimization.com once, applied dynamically |
| MCP | `mcp` Python SDK (FastMCP) | Stdio + Streamable HTTP transports both built in |

Top-level deps captured in `requirements.txt` (regenerate after any new
`pip install` with `uv pip freeze --python .venv/bin/python > requirements.txt`).

---

## 3. Architecture at a glance

```
Email fixture / Website ─► Extraction pipeline ─► Brain pages (JSON on disk)
                              │                       │
                              ▼                       ▼
                  Narrow agents (per type)      Graph sync ─► nodes / edges
                  + canonicalizer (code-based)         │
                                                      ▼
                                              chunker + fastembed
                                                      │
                                                      ▼
                                              chunks (vec + tsvector)

Browser ─► Dashboard (FastAPI + Cytoscape) ─► /api/graph, /api/search,
                                              /api/ask, /api/initialize,
                                              /api/enrich, /api/stream (SSE),
                                              /api/questions, /api/ci, …

Claude Desktop / Claude.ai ─► MCP server (stdio | HTTP) ─► same src.* code
```

Layered on purpose:

- `src/extraction/` — agents + pipeline orchestration (writes brain pages)
- `src/brain/` — `BrainPage` data class + template loader
- `src/db/` — all SQL lives here (nodes, edges, chunks, questions)
- `src/graph/` — turns brain pages into graph edges with a closed predicate vocab
- `src/seed/` — CI extraction + website-seed orchestration
- `src/dashboard/` — FastAPI server + static frontend
- `src/mcp_server.py` — MCP tool wrappers (Claude-callable)
- `src/canonicalize.py` — deterministic name matching used by both the
  extraction canonicalizer and the graph cross-reference resolver
- `src/embeddings.py` — fastembed wrapper (lazy-load, singleton)
- `src/search.py` — query embedding + hybrid search entry point
- `src/qa.py` — RAG with graph augmentation (the dashboard's /api/ask)
- `src/usage.py` + `src/events.py` — in-process counters + pub/sub for SSE

---

## 4. Repository layout

```
.
├── .env                     gitignored — LLMBase keys, DATABASE_URL
├── .env.example
├── .gitignore               .env, .venv, .claude/, data/, __pycache__/, .DS_Store
├── .mcp.json                Claude Code auto-registration for the MCP server
├── .python-version          3.12 (uv pins the venv)
├── HANDOVER.md              this file
├── README.md
├── requirements.txt         deps captured with uv pip freeze
├── brain_pages/             output of the extraction pipeline (JSON)
│   ├── persons/
│   ├── companies/
│   └── projects/
├── data/                    gitignored — ci.json (persisted CI per tenant)
├── fixtures/
│   ├── sample_delta_response.json     fixture emails
│   ├── person_brain_page.json         template (null defaults)
│   ├── company_brain_page.json
│   └── project_brain_page.json
├── scripts/
│   └── reinitialize.sh      kills uvicorn, wipes state, restarts server
└── src/
    ├── __init__.py          loads .env from absolute path on first import
    ├── canonicalize.py      fuzzy match name → known canonical
    ├── config.py            REPO_ROOT, FIXTURES_DIR, BRAIN_DIR, LLM env
    ├── embeddings.py        fastembed wrapper (BAAI/bge-small-en-v1.5)
    ├── events.py            in-process pub/sub bus (thread-safe queue)
    ├── mcp_server.py        FastMCP server, 5 tools
    ├── qa.py                /api/ask: RAG + graph expansion + cited synth
    ├── search.py            /api/search: embed query → hybrid_search
    ├── usage.py             token counter (thread-safe)
    ├── brain/
    │   └── page.py          BrainPage dataclass + JSON load/save
    ├── db/
    │   ├── chunks.py        insert / delete_for_page / hybrid_search
    │   ├── connection.py    psycopg connect via DATABASE_URL
    │   ├── edges.py         add / get / delete_for_page
    │   ├── init_db.py       runs schema.sql (idempotent)
    │   ├── nodes.py         find / add / resolve / update_page_path
    │   ├── questions.py     save / list / get / delete (Search-tab history)
    │   └── schema.sql       full DDL (pgvector, HNSW, GIN, all tables)
    ├── extraction/
    │   ├── clean.py         html_to_text
    │   ├── chunker.py       BrainPage → list[chunk dict]
    │   ├── pipeline.py      ExtractionPipeline (parallelized)
    │   └── agents/
    │       ├── base.py      Agent base + retry + concurrency semaphore
    │       ├── identifier.py
    │       ├── canonicalizer.py    code-based, no LLM call
    │       ├── person.py / company.py / project.py
    │       ├── description.py      writer + updater
    │       ├── judgment.py         relationship + status
    │       └── timeline.py
    ├── graph/
    │   └── sync.py          sync_page_to_graph + closed predicate vocab
    ├── seed/
    │   └── starter_entities.py  pre-create anchor brain pages (company/people/projects)
    └── dashboard/
        ├── server.py        FastAPI app (all /api/*)
        ├── __main__.py      uvicorn entry point
        └── static/          index.html, style.css, app.js, rpx-logo.png
```

---

## 5. Database schema (Postgres)

```
nodes      (id, type, name, page_path)
edges      (id, subject, predicate, object, source_page)
chunks     (id, page_path, node_id, section, date, text,
            embedding VECTOR(384), keywords TSVECTOR, created_at)
questions  (id, question, answer, sources JSONB, created_at)
```

Indexes:
- `chunks_embedding_idx` — **HNSW** on `embedding vector_cosine_ops`
- `chunks_keywords_idx` — **GIN** on `keywords`
- `chunks_page_path_idx` — btree on `page_path`
- `questions_created_at_idx` — btree desc on `created_at`

Closed **predicate vocabulary** for edges (defined in `src/graph/sync.py`):
- `works_at` — person → company  (from `person.company` field)
- `key_contact_at` — person → company  (from `company.key_contacts[*]`)
- `leads` — person → project  (from `project.rpx_lead`)
- `has_client` — project → company  (from `project.client`)

Add a new predicate by: (a) declaring it as a constant in
`sync.py`, (b) emitting it in the corresponding `_emit_*_edges` helper.
Never invent edges anywhere else.

---

## 6. Key design choices & nuances (the "why")

### 6.1 Deterministic canonicalizer (`src/canonicalize.py`)
**Was** an LLM call (the cheap model). The cheap model failed often enough
that "Felix" and "Dr Felix Kasiske" frequently ended up as two brain
pages. **Now** it's pure code: token-set subset matching + honorific
stripping. Handles every case we cared about (`Felix` → `Felix Kasiske`,
`Michael` → `Michael Dempsey`, `RPX Optimization GmbH` → `RPX Optimization`).
The same helper is used by `src/graph/sync.py` to resolve cross-references
in frontmatter (so `person.company = "RPX Optimization GmbH"` doesn't
spawn an orphan node when `RPX Optimization` already exists).

### 6.2 Concurrency model
The pipeline runs two levels of ThreadPoolExecutor:
- **Per email** — entities fan out across 8 workers (different brain
  pages, no shared mutable state).
- **Per entity** — the 4 LLM-bound agents (frontmatter, judgment,
  description, timeline) fan out across 4 workers.

Emails themselves stay **sequential** — canonicalization needs entities
created by earlier emails to be visible as known-canonical when later
emails are processed; per-email parallelism would race that.

A **module-level `threading.Semaphore`** in `Agent._call` caps total
concurrent LLM calls across the whole process (default 4, tunable via
`LLM_BASE_MAX_CONCURRENCY`). The orchestration layer can fan out as wide
as it wants; the semaphore queues it down to what LLMBase tolerates.
LLMBase rate-limits at ~4-8 concurrent — we found the hard way that 32
in flight triggers `429 too_many_concurrent_requests`.

Plus exponential-backoff retry with jitter on transient errors
(429 / timeout / 5xx), up to 5 attempts.

### 6.3 SSE with id-diff polling, not event instrumentation
`/api/stream` polls the DB every 250 ms via `asyncio.to_thread` (sync
psycopg in an async endpoint without blocking the loop). It tracks
which ids it has already pushed to *this* client and emits
`node_added` / `node_removed` / `edge_added` / `edge_removed` based on
the diff. Required because the sync layer deletes-and-re-inserts edges
on every page re-sync — the frontend was accumulating ghost edges
because deletions never reached it.

Higher-level events (`email_started`, `email_completed`,
`usage_updated`, `ci_updated`) use the in-process event bus
(`src/events.py`) — they're not derivable from DB diffs.

### 6.4 Chunking strategy
One chunk per text-bearing section: the description (one) + each
timeline entry (one each). Frontmatter is structured data; we
deliberately don't embed it (graph queries handle attribute lookups).
Each chunk's text is **prefixed with the entity name** (and date for
timeline) so the embedding captures who/when it's about, not just the
bare sentence.

Hybrid search combines top-N vector and top-N keyword candidates,
scored `vec * 0.7 + kw * 0.3`. Returned to the UI with both scores so
it can show which signal fired.

### 6.5 MCP tools deliberately don't synthesize
`search_brain` returns raw ranked chunks. Synthesis is Claude's job.
This:
- Saves tokens (no double-LLM)
- Gets Claude's reasoning quality, not gpt-oss-120b's
- Means the same MCP tool works equally well whether Claude wants a
  short answer, a long answer, or a multi-step exploration

### 6.6 Single tenant today, but designed for tenant-id later
Every db/* function and every src/* module currently assumes one
brain. The agreed migration path:
- **Tenant column** + Postgres **Row-Level Security** on all
  data-bearing tables (nodes, edges, chunks, questions).
- The MCP server's OAuth shell extracts `tenant_id` from the bearer
  token and scopes every query.

This is documented in the codebase as TODOs and in §9 below.

### 6.7 Frontend
- Three tabs: empty-state form (when not initialized), knowledge graph
  (Cytoscape + fcose), search (question + answer + sources panes, with
  a "Recent questions" sidebar).
- Loading states: shimmer-skeleton lines for the answer, pulsing dot
  for "synthesizing", animated brand-color edges for live updates.
- Markdown rendering via marked.js + post-process `[N]` citations into
  clickable spans.
- CI applied at runtime: brand colour and font swap via CSS custom
  properties; the Google Fonts `<link>` href is rewritten to load the
  brand font.

---

## 7. Operational reference

### Ports
- **8000** — dashboard (FastAPI/uvicorn). Started by
  `.venv/bin/python -m src.dashboard` or `./scripts/reinitialize.sh`.
- **8765** — MCP server, HTTP transport.
  `.venv/bin/python -m src.mcp_server --transport streamable-http`.
- **5432** — Postgres (the `rpx_brain` database).

### Reset & restart
`./scripts/reinitialize.sh` — kills any uvicorn on :8000, wipes
brain pages + `data/ci.json` + DB tables (`nodes`, `edges`,
`chunks`, `questions`), runs `init_db` to ensure the schema is
applied, then starts the dashboard in the foreground.

Hard-refresh the browser after running it (the frontend doesn't
reset its Cytoscape state on SSE reconnect — known limitation).

### Claude Desktop config

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "rpx-brain": {
      "command": "/Users/juliuskasiske/Documents/indigo_iota/test_1/.venv/bin/python",
      "args": ["-m", "src.mcp_server"],
      "env": {
        "PYTHONPATH": "/Users/juliuskasiske/Documents/indigo_iota/test_1"
      }
    }
  }
}
```

Notes that took a while to land:
- Claude Desktop's `cwd` field is inconsistent — don't rely on it.
  Use `PYTHONPATH` to give Python the import root.
- macOS TCC blocks Claude.app from exec'ing **shell scripts** even
  with Documents folder access granted. Direct binary invocation
  of `.venv/bin/python` works. Don't wrap in a `.sh`.
- `src/__init__.py` loads `.env` via absolute path computed from
  `__file__`, so `load_dotenv()` works regardless of the launcher's cwd.

### Tuning concurrency
Set `LLM_BASE_MAX_CONCURRENCY` in `.env`. Default 4. Try 8 if you
stop seeing 429s; back off if they reappear.

### Token tracking
`src/usage.py` tracks prompt + completion tokens across the process.
`/api/usage` returns the snapshot; the dashboard header counter ticks
live via the SSE `usage_updated` event. `POST /api/usage/reset` zeroes
it; `reinitialize.sh` calls that.

---

## 8. Known limitations & gotchas

| | |
|---|---|
| **Single tenant** | All data scoped to one brain. Multi-tenant refactor is roadmap §9.4. |
| **Brain pages on disk** | Filesystem JSON, not DB. Fine at this scale; awkward for multi-tenant. |
| **Frontend doesn't reset on reinit** | If you reinitialize without hard-refreshing the browser, old Cytoscape state lingers and new SSE node_added events whose ids collide get skipped. Always hard-refresh after `reinitialize.sh`. |
| **Cheap-model variance** | The IdentifierAgent occasionally returns empty `[]` (bad JSON, defensive fallback). The pipeline tolerates it; a retry usually works. |
| **fastembed cold start** | First call downloads the ONNX model (~133 MB). Adds ~30s to the first init. Cached at `~/.cache/fastembed` after. |
| **No tests** | Some inline `python -c` smoke tests live in commit messages; no pytest. Adding tests is recommended before any structural refactor. |
| **`.DS_Store` is tracked** | Added before the gitignore entry. `git rm --cached .DS_Store` to clean if it bothers you. |
| **MCP tools don't surface tenant_id** | When multi-tenancy lands, every tool needs to gain a `tenant_id` (or read it from the bearer token). |

---

## 9. Roadmap (priority order)

### 9.1 — Phase 3: OAuth for remote MCP (next)
Required for the connector to be reachable from claude.ai.
- `authlib`-based authorization-code + PKCE server
- Endpoints: `/.well-known/oauth-authorization-server`, `/authorize`,
  `/token`, token refresh
- Token storage in DB (new `oauth_tokens` table)
- FastMCP hook validates bearer on every tool call

~1 day of focused work. Implementation can stay single-tenant for
now (hardcoded user) — the same scaffold extends to multi-tenant.

### 9.2 — Phase 4: public deployment
Choose hosting:
- **Fly.io** (recommended) — `flyctl deploy`, free tier covers this
- Render / Railway as alternatives

Plus Postgres:
- **Neon** free tier, or
- Fly Postgres alongside, or
- Bring-your-own DATABASE_URL

A `Dockerfile` for the FastAPI + MCP-HTTP servers (one image, run via
process supervisor like `honcho` if they need to be separate processes;
otherwise one uvicorn with both ASGI apps mounted).

### 9.3 — Better Claude routing
- Sharpen `src/mcp_server.py`'s server-level `instructions` string to
  more aggressively claim "use rpx-brain first for any person/
  company/project name" without breaking the public-figure case.
- Document the "Claude Desktop Project with custom system prompt"
  workflow as the recommended user-side default.

### 9.4 — Multi-tenancy
Agreed strategy: **tenant column + Postgres RLS**.
- Schema: `tenant_id` on `nodes`, `edges`, `chunks`, `questions`;
  CREATE POLICY for RLS.
- Code: every `src/db/*.py` function gains a `tenant_id` parameter
  and a WHERE filter; RLS catches misses.
- `src/extraction/pipeline.py` takes a `tenant_id`; `brain_dir`
  becomes `brain_pages/<tenant>/`.
- `data/ci.json` becomes `data/tenants/<tenant>/ci.json` (or moves
  to a `tenants` table).
- `src/dashboard/server.py` reads `tenant_id` from the request
  (session for the dashboard, OAuth bearer for MCP).
- Reset script becomes per-tenant.

~2-4 days for the data refactor + provisioning flow.

### 9.5 — Agentic features (the longer arc)
- **Pre-meeting briefings** — given a person, assemble everything we
  know about them + their orgs + active projects.
- **Follow-up suggestions** — last-interaction stale watcher.
- **RFP-to-prior-work matcher** — vector-search incoming RFP text
  against existing project descriptions.
- **Conflict-of-interest scanner** — uses the graph to flag overlaps
  before assigning staff.
- **Sentiment / trajectory monitoring** — analyse tone over time per
  project edge.

These build on the chunks + graph + LLM stack that's already in place;
each one is a few new tools or pipeline steps.

### 9.6 — Smaller cleanups
- Add proper tests (pytest, with a test DB).
- Add `.DS_Store` removal from tracking.
- Reset the frontend's Cytoscape state on SSE reconnect so reinit
  doesn't require a manual hard-refresh.
- Add a CI extractor fallback when the homepage is fully JS-rendered
  (currently uses `requests`; sites like Vercel/Next.js apps with
  client-side routing only would need a headless browser).
- Wire chunks-table TRUNCATE through a UNIQUE constraint on
  (subject, predicate, object) in `edges` to fully close the
  race window in `resolve_node` / `add_edge`.

---

## 10. Getting started for the next developer

```
# 1. Clone, then bootstrap the venv.
cd /Users/juliuskasiske/Documents/indigo_iota/test_1
curl -LsSf https://astral.sh/uv/install.sh | sh        # if not present
uv python install 3.12
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt

# 2. .env (copy .env.example, fill in LLM_BASE_API_KEY + DATABASE_URL).
cp .env.example .env
$EDITOR .env

# 3. Schema.
.venv/bin/python -m src.db.init_db

# 4. Run the dashboard.
.venv/bin/python -m src.dashboard
# → http://127.0.0.1:8000  (hard-refresh once after first load)

# 5. (Optional) test the MCP server locally before wiring to Claude.
printf '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{...}}\n' \
  | .venv/bin/python -m src.mcp_server
```

End-to-end demo:

```
./scripts/reinitialize.sh         # wipe + start uvicorn (foreground)
# in browser: hard-refresh, fill the empty-state form with
#   "RPX Optimization" + https://rpxoptimization.com → Initialize
# wait ~30-60s for the seed to finish
# click "Enrich from emails" → another ~30-60s
# explore the graph; try the Search tab
```

To talk to the brain through Claude Desktop, see §7 *Claude Desktop config*.

---

## 11. Commit history highlights (this session)

Reverse chronological — for orientation:

- `6aff5c3` snapshot: brain pages from latest demo run + ignore `__pycache__`
- `b6d451a` mcp: load .env by absolute path so Claude Desktop spawn works
- `db74d77` add mcp-server-stdio.sh wrapper for Claude Desktop spawn  *(later removed)*
- `09931e8` add MCP server: tools that expose the brain to Claude
- `1d1ccd4` rename chats → questions across the stack
- `6191b2a` search tab: chat history sidebar + persisted Q&As
- `93e1e20` search tab: shimmer skeleton while answering + markdown rendering
- `f6a3169` fix enrich: cap concurrent LLM calls with a global semaphore
- `06ab7d0` parallelize agents: per-entity + per-email fan-out
- `28f0ab6` add chunks table + hybrid search (pgvector + tsvector)
- `e8e2065` canonicalizer: replace LLM call with deterministic matching
- `833ac55` fix ghost edges + collapse short-form node duplicates
- `eb9a712` reinitialize.sh: also kill old server and start a fresh one
- `b025420` add init UI with live graph growth + dynamic CI
- `bf95864` add website seed: initialize graph from a company site
- `02b0e26` add CI extractor: logo, colors, font, tagline from a website
- `e56a5ee` fix dashboard fcose: load peer deps, add cose fallback
- `1139a42` add FastAPI + Cytoscape.js dashboard with RPX CI
- `72dafea` persist nodes and edges to graph DB on every page write
- `1478717` add canonicalizer agent, fix template leakage, drop v1 orphans

Use `git log --oneline` for the full sequence.
