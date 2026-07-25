"""Transactional email sender.

When IOTA_SMTP_HOST is smtp.resend.com (or the password starts with "re_"),
emails are sent via Resend's HTTP API (POST https://api.resend.com/emails)
over port 443 — which is always open, unlike SMTP port 465 which Hetzner
blocks on new servers. IOTA_SMTP_PASSWORD is the Resend API key.

For any other SMTP host the original SMTP path is used unchanged.

DEV FALLBACK: when IOTA_SMTP_HOST is unset, nothing is sent — the full
message (including any link) is written to the iota.mailer log at WARNING
so the invite/reset flow can be exercised locally without a real mail server.

Configuration (all via env):

    IOTA_SMTP_HOST        SMTP server hostname.   Unset => DEV FALLBACK.
    IOTA_SMTP_PORT        Port. Default 587. (Unused for Resend HTTP path.)
    IOTA_SMTP_USERNAME    Login user. (Unused for Resend HTTP path.)
    IOTA_SMTP_PASSWORD    SMTP password, or Resend API key (starts with re_).
    IOTA_SMTP_FROM        From header, e.g. "Indigo Iota <noreply@indigo-iota.com>".
    IOTA_SMTP_SECURITY    "starttls" (default), "ssl", or "none". (Unused for Resend.)
"""
from __future__ import annotations

import logging
import os
import smtplib
import ssl
from email.message import EmailMessage

import httpx

log = logging.getLogger("iota.mailer")

ENV_HOST     = "IOTA_SMTP_HOST"
ENV_PORT     = "IOTA_SMTP_PORT"
ENV_USERNAME = "IOTA_SMTP_USERNAME"
ENV_PASSWORD = "IOTA_SMTP_PASSWORD"
ENV_FROM     = "IOTA_SMTP_FROM"
ENV_SECURITY = "IOTA_SMTP_SECURITY"

_DEFAULT_FROM   = "Indigo Iota <noreply@indigo-iota.com>"
_TIMEOUT_SECONDS = 20
_RESEND_API_URL = "https://api.resend.com/emails"


class MailerConfigError(RuntimeError):
    """SMTP is misconfigured."""


def is_configured() -> bool:
    """True if a real mail host is set (otherwise sends use the dev fallback)."""
    return bool((os.environ.get(ENV_HOST) or "").strip())


def _use_resend_http(host: str, password: str) -> bool:
    """Use Resend's HTTP API when the host is Resend's SMTP gateway or the
    key looks like a Resend API key. Avoids SMTP port 465 which cloud
    providers (Hetzner, AWS etc.) often block on new servers."""
    return host == "smtp.resend.com" or password.startswith("re_")


def send_email(
    to: str,
    subject: str,
    text_body: str,
    html_body: str | None = None,
) -> None:
    """Send one email. Falls back to logging when SMTP isn't configured.

    Raises MailerConfigError / HTTP/SMTP errors on failure so callers can
    surface a meaningful error rather than silently dropping the message.
    """
    sender = (os.environ.get(ENV_FROM) or _DEFAULT_FROM).strip()

    if not is_configured():
        log.warning(
            "[mailer] SMTP not configured (%s unset) — NOT sending. "
            "to=%s subject=%r\n--- begin email body ---\n%s\n--- end email body ---",
            ENV_HOST, to, subject, text_body,
        )
        return

    host     = os.environ[ENV_HOST].strip()
    password = os.environ.get(ENV_PASSWORD) or ""

    if _use_resend_http(host, password):
        _send_via_resend_api(
            api_key=password,
            sender=sender,
            to=to,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )
    else:
        _send_via_smtp(
            host=host,
            sender=sender,
            to=to,
            subject=subject,
            text_body=text_body,
            html_body=html_body,
        )

    log.info("[mailer] sent email to=%s subject=%r", to, subject)


def _send_via_resend_api(
    api_key: str,
    sender: str,
    to: str,
    subject: str,
    text_body: str,
    html_body: str | None,
) -> None:
    """Send via Resend's HTTP API (port 443 — never blocked)."""
    payload: dict = {
        "from": sender,
        "to": [to],
        "subject": subject,
        "text": text_body,
    }
    if html_body:
        payload["html"] = html_body

    resp = httpx.post(
        _RESEND_API_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json=payload,
        timeout=_TIMEOUT_SECONDS,
    )
    if resp.status_code not in (200, 201):
        raise MailerConfigError(
            f"Resend API error {resp.status_code}: {resp.text}"
        )


def _send_via_smtp(
    host: str,
    sender: str,
    to: str,
    subject: str,
    text_body: str,
    html_body: str | None,
) -> None:
    """Send via plain SMTP (non-Resend hosts)."""
    port     = int((os.environ.get(ENV_PORT) or "587").strip())
    username = (os.environ.get(ENV_USERNAME) or "").strip()
    password = os.environ.get(ENV_PASSWORD) or ""
    security = (os.environ.get(ENV_SECURITY) or "starttls").strip().lower()

    msg = EmailMessage()
    msg["From"]    = sender
    msg["To"]      = to
    msg["Subject"] = subject
    msg.set_content(text_body)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    if security == "ssl":
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=_TIMEOUT_SECONDS, context=context) as smtp:
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
    elif security in ("starttls", "none"):
        with smtplib.SMTP(host, port, timeout=_TIMEOUT_SECONDS) as smtp:
            if security == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            if username:
                smtp.login(username, password)
            smtp.send_message(msg)
    else:
        raise MailerConfigError(
            f"{ENV_SECURITY}={security!r} is invalid; use 'starttls', 'ssl', or 'none'."
        )
