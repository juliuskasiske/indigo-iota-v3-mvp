# Edge image: builds the Next.js static export, then serves it with Caddy
# (automatic HTTPS) while reverse-proxying the API on the SAME origin — so
# session cookies stay first-party (no CORS, no SameSite=None).
#
# Build context is the REPO ROOT. See docker-compose.prod.yml:
#   build: { context: ../.., dockerfile: infra/prod/web.Dockerfile }

# --- stage 1: build the static site (output: "export" -> ./out) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Lockfile first for a cached install layer (npm ci when present, else install).
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# --- stage 2: Caddy edge serving the static export ---
FROM caddy:2-alpine
COPY infra/prod/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/out /srv
