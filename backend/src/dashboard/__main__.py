"""Run the dashboard with `python -m src.dashboard`.

Starts uvicorn on http://127.0.0.1:8000. The server module is referenced
by import string so uvicorn can reload it.
"""
from __future__ import annotations
import uvicorn


def main() -> None:
    uvicorn.run(
        "src.dashboard.server:app",
        host="127.0.0.1",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()
