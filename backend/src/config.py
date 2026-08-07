"""Loads settings from .env so the rest of the code never hardcodes secrets."""
from __future__ import annotations
import os
from pathlib import Path
from dotenv import load_dotenv

# Reads .env into the environment. Must run before we read any os.environ value.
load_dotenv()

# --- LLMBase API settings ---
# Read non-fatally so the module imports without credentials. This lets the
# cred-free paths run (e.g. precomputed reinit, which only touches the DB +
# local embeddings). The LLM client validates these at call time instead;
# use require_llm_config() to fail loudly right before a live LLM call.
LLM_BASE_API_KEY: str = os.environ.get("LLM_BASE_API_KEY", "")
LLM_BASE_BASE_URL: str = os.environ.get("LLM_BASE_BASE_URL", "")
LLM_BASE_MODEL: str = os.environ.get("LLM_BASE_MODEL", "")

# Q&A (brain inference) runs on a deliberately stronger model than the cheap
# default used for high-volume comprehension: answering questions over the brain
# needs more reasoning + thoroughness than extracting one email.
#
# NO hardcoded model default. A default here is invisible in the deployment's
# env file, so a stale one silently ships: prod ran for months pointed at
# 'nvidia/nemotron-3-ultra-550b-a55b', which LLMBase 404s, and nothing in
# .env.prod hinted at it. Empty falls back to LLM_BASE_MODEL, which at least is
# a model someone deliberately configured.
LLM_QA_MODEL: str = os.environ.get("LLM_QA_MODEL", "") or LLM_BASE_MODEL

# Per-role model overrides for the agent swarm, e.g. LLM_MODEL_DECOMPOSITION.
# The roles are not equally hard: cutting an objective into a genuinely MECE set
# and judging whether evidence carries a number are reasoning tasks, while
# naming an initiative is not. Anything unset falls back to LLM_BASE_MODEL, so
# this is opt-in and costs nothing until used.
def model_for_role(role: str) -> str:
    """The model configured for one swarm role, else the base model."""
    return os.environ.get(f"LLM_MODEL_{role.upper()}", "") or LLM_BASE_MODEL

# --- Google Drive source (shared service account) ---
# ONE service account, created once in our GCP project, serves every customer:
# they share a Drive folder with its email and we read it with this key. Read
# non-fatally so the app boots without it — the Drive "Connect" flow then reports
# "not configured" instead of crashing. GDRIVE_SERVICE_ACCOUNT_JSON is either the
# raw service-account JSON or a path to the key file; GDRIVE_SERVICE_ACCOUNT_EMAIL
# is the address customers share their folders with (shown in the Connect modal).
GDRIVE_SERVICE_ACCOUNT_JSON: str = os.environ.get("GDRIVE_SERVICE_ACCOUNT_JSON", "")
GDRIVE_SERVICE_ACCOUNT_EMAIL: str = os.environ.get("GDRIVE_SERVICE_ACCOUNT_EMAIL", "")


def require_llm_config() -> None:
    """Raise a clear error if any LLMBase setting is missing. Call this at the
    entry to any path that will actually hit the LLM (live comprehension)."""
    missing = [
        name
        for name, value in (
            ("LLM_BASE_API_KEY", LLM_BASE_API_KEY),
            ("LLM_BASE_BASE_URL", LLM_BASE_BASE_URL),
            ("LLM_BASE_MODEL", LLM_BASE_MODEL),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            "Missing LLMBase credentials: "
            + ", ".join(missing)
            + ". Set them in backend/.env to run live comprehension "
            "(precomputed mode does not need them)."
        )

# --- Folder locations (relative to this repo) ---
REPO_ROOT: Path = Path(__file__).parent.parent    # the folder this file sits in
FIXTURES_DIR: Path = REPO_ROOT / "fixtures"       # your sample emails
# Committed seed corpus for the demo / default brain. Brain pages are NOT stored
# here at runtime any more — they live in the brain_pages table of each tenant's
# brain DB (migration 0009). This directory is only the deterministic seed that
# `python -m src.reinit` loads into the default brain for a cred-free demo.
BRAIN_DIR: Path = REPO_ROOT / "brain_pages"       # committed seed pages (demo only)