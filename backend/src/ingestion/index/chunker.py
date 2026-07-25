"""Turn a BrainPage into chunks for embedding + keyword indexing.

One chunk per text-bearing section of the page:
  - description       (one chunk per page when non-empty)
  - timeline entries  (one chunk per entry)

We do NOT chunk frontmatter — it's structured data, search by attribute
belongs in graph queries, not vector similarity.

Each chunk's text is prefixed with the entity's name (and date for
timeline entries) so the embedding captures who/when the snippet is
about, not just the bare sentence.
"""
from __future__ import annotations
import re
from typing import List

from src.ingestion.comprehend.page import BrainPage


def chunk_page(page: BrainPage) -> List[dict]:
    """Return a list of chunk dicts (without embeddings yet).

    Each chunk: {section, date, text}.
    """
    fm = page.data.get("frontmatter") or {}
    name = (fm.get("name") or "").strip() or "(unknown)"
    etype = (fm.get("type") or "").strip()

    chunks: List[dict] = []

    description = (page.data.get("description") or "").strip()
    if description:
        prefix = f"{name} ({etype})" if etype else name
        chunks.append({
            "section": "description",
            "date": None,
            "text": f"{prefix}: {description}",
        })

    for entry in page.data.get("timeline") or []:
        if not isinstance(entry, dict):
            continue
        entry_text = (entry.get("entry") or "").strip()
        if not entry_text:
            continue
        date = (entry.get("date") or "").strip() or None
        head = f"{name} on {date}" if date else name
        chunks.append({
            "section": "timeline",
            "date": date,
            "text": f"{head}: {entry_text}",
        })

    return chunks


def chunk_document(
    name: str,
    markdown: str,
    *,
    target_chars: int = 1000,
    max_block_chars: int = 1500,
) -> List[dict]:
    """Split a document's Markdown into retrievable passages.

    Unlike ``chunk_page`` (one chunk per page section), a document is long-form, so
    we window it into ~``target_chars`` passages on paragraph/heading boundaries.
    Over-long single blocks (e.g. a giant table) are hard-split. Each passage is
    prefixed with the document name so the embedding knows which document the
    snippet is from (mirrors ``chunk_page``'s name prefix). Returns the same
    ``{section, date, text}`` shape, with ``section='content'``.
    """
    text = (markdown or "").strip()
    if not text:
        return []
    label = (name or "").strip() or "(document)"

    # Paragraph/block split (Markdown blocks are separated by blank lines).
    blocks: List[str] = []
    for raw_block in re.split(r"\n\s*\n", text):
        block = raw_block.strip()
        if not block:
            continue
        if len(block) <= max_block_chars:
            blocks.append(block)
        else:  # hard-split a block that's bigger than the window
            for i in range(0, len(block), target_chars):
                piece = block[i:i + target_chars].strip()
                if piece:
                    blocks.append(piece)

    # Greedily pack blocks into ~target_chars passages.
    passages: List[str] = []
    buf = ""
    for block in blocks:
        if buf and len(buf) + len(block) + 2 > target_chars:
            passages.append(buf)
            buf = block
        else:
            buf = f"{buf}\n\n{block}" if buf else block
    if buf:
        passages.append(buf)

    return [
        {"section": "content", "date": None, "text": f"{label}: {p}"}
        for p in passages
    ]
