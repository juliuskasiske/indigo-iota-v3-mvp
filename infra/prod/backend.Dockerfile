# Backend API image: FastAPI + uvicorn, with local fastembed embeddings.
#
# Build context is the REPO ROOT (so we can copy both backend/ and the
# entrypoint under infra/prod/). See docker-compose.prod.yml:
#   build: { context: ../.., dockerfile: infra/prod/backend.Dockerfile }
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app/backend \
    # fastembed / HuggingFace model cache. Baked at build, then mounted as a
    # volume at runtime so it survives image rebuilds.
    HF_HOME=/opt/models \
    FASTEMBED_CACHE_PATH=/opt/models/fastembed

WORKDIR /app

# curl: the container healthcheck below. No compiler needed — psycopg-binary,
# cryptography and onnxruntime all ship manylinux wheels.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first (cached layer; only re-runs when requirements change).
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r /app/backend/requirements.txt

# Application source.
COPY backend/ /app/backend/

# The internal codebase explainer (docs/explainer) is served owner-only by the
# API for the Control Tower Guide tab, so it must live inside the image.
COPY docs/explainer/ /app/docs/explainer/

# Pre-download the local embedding model (~133MB) into the image so the first
# request doesn't pay a cold download. Calling the project's own module means
# the cached model name can never drift from what the code asks for.
RUN python -c "import sys; sys.path.insert(0, '/app/backend'); from src.ingestion.index.embeddings import embed_one; embed_one('warm')"

# Entrypoint brings the databases to head, then serves.
COPY infra/prod/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /app/backend
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
