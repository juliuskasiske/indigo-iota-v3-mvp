"""Stateless helper: turn an email's HTML body into plain text."""
from __future__ import annotations
import re
from html import unescape


def html_to_text(html: str) -> str:
    """Strip HTML tags and decode entities, returning readable plain text."""
    text = re.sub(r"<(br|/div|/p)\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = unescape(text)
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()