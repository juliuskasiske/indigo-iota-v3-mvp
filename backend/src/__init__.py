"""Package init for `src`.

Loads .env from the project root once, on any import of src.*, using an
absolute path resolved from this file. That way the rest of the codebase
works whether it's launched from the project root (FastAPI dashboard,
CLI scripts) or from anywhere else (Claude Desktop spawns MCP servers
from `/`, with no cwd guarantee).
"""
from pathlib import Path
from dotenv import load_dotenv

# This file lives at <repo>/src/__init__.py; .env lives at <repo>/.env.
_REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_REPO_ROOT / ".env")
