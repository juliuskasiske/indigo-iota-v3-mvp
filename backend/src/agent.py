"""The 'agent': a single LLMBase API call that updates a brain page from an email."""
from __future__ import annotations
from openai import OpenAI
from src import config, usage
from src.billing import metering

# LLMBase is OpenAI-compatible, so we use the OpenAI client but point it
# at LLMBase's URL. Same SDK, different server.
_client = OpenAI(
    api_key=config.LLM_BASE_API_KEY,
    base_url=config.LLM_BASE_BASE_URL,
)

def _update_description_agent(email_text: str, existing_description: str | None) -> str:
    """
    There is a separate agent that only updates the top description part 
    of the brain page, without touching the timeline. It's not used in this codebase, 
    but you could imagine using it if you wanted more frequent description updates 
    (e.g. after every email) instead of waiting for a "significant" email to trigger a 
    full page update.
    """
    prompt: str = (
        """You are given a description of a person. The existing description is presumed correct. 
        Only set update_needed to true if the email contradicts it or adds something 
        that materially changes who this person is. Routine updates, new events, 
        and minor details are NOT reasons to update."""
        + f"\n\nExisting description:\n{existing_description or 'NONE'}\n\nEmail:\n{email_text}")

def email_to_brain_page(email_text: str, existing_page: str | None) -> str:
    """
    Given an email and the current brain page it concerns, return the
    updated brain page.

    Args:
        email_text:    the email, as plain text (sender, subject, body)
        existing_page: current markdown of the brain page, or None if
                       no page exists yet

    Returns:
        the updated brain page as a markdown string
    """
    # The prompt defines what a brain page looks like and how to update it.
    # Being specific here is what makes the output consistent.
    prompt: str = (
        "You maintain markdown 'brain pages' for a consultancy.\n\n"
        "A brain page has two parts:\n"
        "- Top: a compiled summary of who/what the page is about.\n"
        "- Below a line of '---': append-only dated timeline entries.\n\n"
        "Below is an email and the current brain page it concerns "
        "('NONE' if no page exists yet).\n\n"
        "Your task: return the FULL updated brain page. Append one new "
        "dated timeline entry describing what this email tells us. Only "
        "rewrite the top summary if the email genuinely changes it. "
        "Return only the markdown, nothing else.\n\n"
        f"=== EXISTING PAGE ===\n{existing_page or 'NONE'}\n\n"
        f"=== EMAIL ===\n{email_text}"
    )

    # Hard credit cap: block BEFORE the call fires if the org is over its limit
    # (no-op for system usage with no org in context).
    metering.enforce_credit_limit()

    # The actual API call. max_tokens caps the response length.
    resp = _client.chat.completions.create(
        model=config.LLM_BASE_MODEL,
        max_tokens=1500,
        messages=[{"role": "user", "content": prompt}],
    )

    # Meter the call (live counter + durable costed ledger). Best-effort.
    u = getattr(resp, "usage", None)
    if u is not None and getattr(u, "prompt_tokens", None) is not None:
        usage.record(u.prompt_tokens, u.completion_tokens)
        metering.record_safe(
            model=getattr(resp, "model", None) or config.LLM_BASE_MODEL,
            prompt_tokens=u.prompt_tokens,
            completion_tokens=u.completion_tokens,
            request_kind="page_update",
            request_id=getattr(resp, "id", None),
        )

    # The OpenAI-style response wraps the text a few levels deep.
    return resp.choices[0].message.content