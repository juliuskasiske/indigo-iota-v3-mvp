"""Generate the Exchange Online command that pins the connector's Mail.Read to
the in-scope mailbox(es).

This is the single Python source of truth for that command. The admin API
endpoint (/api/admin/access-policy-command) calls ``build_access_policy_command``
so the generated block is testable in isolation, without the HTTP/auth layer.

It deliberately mirrors backend/scripts/application-access-policy.ps1 (the
standalone script an Exchange admin can run by hand): create the scope group if
missing, add each in-scope mailbox to it, then bind a RestrictAccess policy.
The two are kept in step by hand — tests assert they use the same cmdlets and
the same RestrictAccess access right so a change to one that forgets the other
is caught.
"""
from __future__ import annotations

from typing import List


def build_access_policy_command(
    connector_app_id: str, scope: str, mailboxes: List[str]
) -> dict:
    """Return ``{"command", "test_command"}`` for the given connector + scope.

    ``connector_app_id`` is the Connector app's client id (the one holding the
    Mail.Read application permission). ``scope`` is the mail-enabled security
    group address. ``mailboxes`` are the in-scope addresses to place in it;
    blank entries are dropped. All three are passed through verbatim inside
    double-quoted PowerShell arguments, so the caller should validate them
    upstream (the chip UI already validates the mailbox addresses).
    """
    app_id = connector_app_id.strip()
    scope = scope.strip()
    mailboxes = [m.strip() for m in mailboxes if m.strip()]

    lines = [
        "# 0. Install + sign in to Exchange Online (a browser sign-in window opens).",
        "if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {",
        "    Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force",
        "}",
        "Import-Module ExchangeOnlineManagement",
        "Connect-ExchangeOnline",
        "",
        "# 1. Create the scope group if it does not exist yet.",
        f'if (-not (Get-DistributionGroup -Identity "{scope}" -ErrorAction SilentlyContinue)) {{',
        f'    New-DistributionGroup -Name "{scope}" -PrimarySmtpAddress "{scope}" -Type Security | Out-Null',
        "}",
    ]
    if mailboxes:
        lines += ["", "# 2. Put the mailboxes you onboarded into that group."]
        lines += [
            f'Add-DistributionGroupMember -Identity "{scope}" -Member "{mbx}" -ErrorAction SilentlyContinue'
            for mbx in mailboxes
        ]
    lines += [
        "",
        "# 3. Restrict the connector so it can read ONLY that group's mailboxes.",
        f"New-ApplicationAccessPolicy -AppId {app_id} "
        f'-PolicyScopeGroupId "{scope}" -AccessRight RestrictAccess '
        f'-Description "Indigo Iota connector — restrict Mail.Read to in-scope mailboxes"',
    ]
    command = "\n".join(lines)

    # Verify each onboarded mailbox is Granted (and the policy actually bit).
    if mailboxes:
        test = "\n".join(
            f'Test-ApplicationAccessPolicy -AppId {app_id} -Identity "{mbx}"'
            for mbx in mailboxes
        )
    else:
        test = f'Test-ApplicationAccessPolicy -AppId {app_id} -Identity "{scope}"'
    return {"command": command, "test_command": test}
