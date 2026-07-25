# Indigo Iota — client demo (v1)

The project brain for consultancies. Ingests the communication exhaust of an
engagement (emails, Slack, files) and auto-maintains living **brain pages** for
people / companies / projects, a **knowledge graph**, and **cited Q&A** over
local embeddings.

This repo merges two earlier prototypes into one product:

- `backend/` — FastAPI + Postgres (pgvector) extraction engine. Brain pages,
  graph (nodes/edges), hybrid search, MCP server. Local embeddings (fastembed,
  no external API). LLM via an EU-hosted, OpenAI-compatible endpoint (LLMBase).
- `frontend/` — Next.js dashboard (currently the original mockup; being trimmed
  to the entity-brain core and rewired to the real API).
- `infra/` — `docker-compose.yml` for Postgres + pgvector.
- `corpus/` — mock emails / Slack / files (authored later, design-backward from
  the target brain state).

## Quick start

```bash
# 1. Database — either use a local Postgres.app DB:
createdb indigo_demo
# ...or the docker one:
docker compose -f infra/docker-compose.yml up -d

# 2. Backend env
cp backend/.env.example backend/.env   # set DATABASE_URL (LLM creds optional)

# 3. Python deps
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# 4. Re-initialize the demo brain
python -m src.reinit                 # precomputed (cred-free, from brain_pages/)
python -m src.reinit --mode live     # full extraction (needs LLM creds + corpus/)
```

## Two reinit modes

- **precomputed** — rebuilds the graph + embeddings from the committed brain
  pages. Deterministic, no LLM cost. Use for reliable client demos.
- **live** — runs the real extraction pipeline over the mock corpus so you can
  watch the brain build itself. Needs LLMBase credentials.

## Multi-tenant product API

Beyond the single-DB demo brain, the backend hosts the real product surface:
a control plane plus one isolated brain database per customer.

```bash
cd backend

# Control plane + provision a customer tenant (own brain DB, migrated, admin seeded)
python -m src.tenancy.provision init-control
python -m src.tenancy.provision create-org --name "Acme GmbH" --slug acme \
    --admin-email admin@acme.de
python -m src.tenancy.provision list

# Configure a customer's EntraID SSO (per-org, single-tenant app registration)
python -m src.tenancy.provision set-sso --slug acme \
    --tenant-id <entra-tenant-id> --client-id <app-client-id> \
    --redirect-uri https://api.indigo-iota.com/auth/callback

# Run the product API (EntraID SSO + sessions + role gating)
uvicorn src.api.app:app --reload --port 8099
```

Auth is backend-driven OIDC (authorization-code + PKCE) against the customer's
Entra tenant; the frontend never sees a Microsoft token. Set `IOTA_DEV_LOGIN=1`
to use `POST /auth/dev-login` for building the Admin Center before a real tenant
is wired up. See `backend/.env.example` for the `SESSION_SECRET` / SSO settings.

## Status

- **Milestone 1** — monorepo + schema + DB + reinit.
- **Onboarding #1** — database-per-tenant control plane + provisioning CLI.
- **Onboarding #2** — EntraID SSO (OIDC/PKCE), signed sessions, role gating.
- **Onboarding #3** — LLM metering + credit ledger. Every API call is costed
  with the model used and input/output tokens priced separately at the price in
  effect *at the time* (`python -m src.billing`).

Next: the ingest-side email-exclusion filter, then the Admin Center frontend.
