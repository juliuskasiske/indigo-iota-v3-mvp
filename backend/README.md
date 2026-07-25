# Indigo Iota — backend

FastAPI + Postgres engine behind the product. It turns the communication exhaust
of an engagement (today: email) into living **brain pages**, a derived
**knowledge graph**, and **cited Q&A** over local embeddings — isolated per
customer, metered per LLM call.

No ORM: raw SQL over psycopg3. Embeddings are local (fastembed, no external API);
the LLM is an EU-hosted, OpenAI-compatible endpoint (LLMBase).

## The ingestion pipeline

Email becomes brain in four named stages (`src/ingestion/`):

1. **Capture** (`capture/`) — pull messages from Microsoft Graph (delta sync, so
   re-runs only fetch what changed) and land each as a `captured_events` row.
   Runs against a live mailbox or replays a JSON file offline.
2. **Triage** (`triage/`) — decide what's in scope. Out-of-scope mail is dropped
   with a recorded reason (`triage_exclusions`); nothing silently vanishes.
3. **Comprehend** (`comprehend/`) — the metered, LLM-bound half. For each
   captured event it **writes the brain page first** (the page is the source of
   truth), then derives the graph from it.
4. **Index** (`index/`) — chunk + embed pages so search and Q&A can find them.

Capture + triage are cheap and run often; comprehend + index are credit-metered
and run on their own cadence so they can stop and resume cleanly (`runner.py`,
`scheduler.py`).

## Data model, in one breath

A **brain page** is a JSON document (`{frontmatter, description, timeline,
relationships}`) stored as a JSONB row in the per-tenant `brain_pages` table,
keyed by `page_path` (e.g. `persons/jane-doe.json`). **The page is the source of
truth.** The `entities`, `relationships`, and `chunks` tables are a *derived*
index, rebuilt from the page by `sync_page_to_graph` — so a graph that drifts can
always be regenerated from the pages.

Entity and relationship types are **customer-defined** (the `entity_types` /
`entity_type_fields` / `relationship_types` ontology), not hardcoded —
person/company/project are only the default starter set.

Provenance ties it together: `comprehension_log` records one receipt per captured
event, and `comprehension_pages` records which pages that event touched (the
source-of-truth link), with `comprehension_entities` / `_relationships` as the
derived graph-side view.

## Multi-tenancy

Database-per-tenant on one Postgres server: a **control plane** DB (orgs, users,
SSO config, billing ledger, audit log) plus **one isolated brain DB per
customer**. Tenant schema lives in ordered migrations `migrations/tenant/NNNN_*.sql`
(never edit an applied file — add the next number); the control-plane schema is
`src/db/control_schema.sql`.

## Billing & audit

- **Metering** (`src/billing/`) — every LLM call is costed by model and by
  input/output tokens at the price in effect *at the time*. A hard credit cap
  blocks calls once an org spends what it funded; the batch processor catches
  that and stops cleanly. Internal figures are raw cost; the customer-facing
  number applies the markup at the API boundary only.
- **Audit** (`src/audit.py`) — sensitive control-plane events land in
  `audit_log`: org provisioning, SSO config, customer erasure, login
  success/denial, and the first blocked call when an org runs out of credits.

## Auth

Backend-driven OIDC (authorization-code + PKCE) against each customer's Entra
tenant; the frontend never sees a Microsoft token. Sessions are signed cookies
with role gating. Set `IOTA_DEV_LOGIN=1` to use `POST /auth/dev-login` while
building the Admin Center before a real tenant is wired up.

## Run it

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # DATABASE_URL; LLM + SSO creds optional for the demo

# Rebuild the single-DB demo brain (precomputed = cred-free; live = real extraction)
python -m src.reinit
python -m src.reinit --mode live

# Product surface: control plane + a customer tenant
python -m src.tenancy.provision init-control
python -m src.tenancy.provision create-org --name "Acme GmbH" --slug acme \
    --admin-email admin@acme.de

# Ingest a mailbox (offline replay shown; drop --from-file for live Graph)
python -m src.ingestion --mailbox jane@acme.de \
    --from-file fixtures/sample_delta_response.json --process

# Serve the API
uvicorn src.api.app:app --reload --port 8099

# Billing CLI (grant credits, estimate a backfill, inspect spend)
python -m src.billing
```

## Layout

```
src/
  ingestion/   capture · triage · comprehend · index  (+ runner, scheduler)
  db/          connection pooling, control-plane schema, brain_pages repo
  tenancy/     provisioning CLI, per-tenant DB create/migrate/erase
  auth/        OIDC/PKCE, sessions, control-plane identity lookups
  billing/     LLM metering, credit ledger, price book, backfill estimator
  api/         FastAPI app (auth + admin + Q&A endpoints)
  qa.py        cited Q&A over embeddings
  search.py    hybrid search
  audit.py     control-plane audit-log writer
  mcp_server.py  read-only MCP access to the brain
  reinit.py    rebuild the demo brain (precomputed | live)
migrations/tenant/  ordered per-tenant schema migrations
tests/         pytest suite
```

See `../docs/explainer/` for an interactive walkthrough of the data model,
flows, and repo layout.
