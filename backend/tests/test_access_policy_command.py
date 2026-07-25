"""Unit tests for the Exchange Online access-policy command generator.

The generator turns the in-scope mailboxes an operator enters into the
PowerShell that pins the connector's Mail.Read to just those mailboxes. These
tests prove:

  * each mailbox lands in the command (it is not dropped on the floor),
  * blank / whitespace entries are ignored,
  * with no mailboxes the test command falls back to the scope group,
  * the generated block stays in step with the standalone
    application-access-policy.ps1 (same cmdlets, same RestrictAccess right) so
    the two implementations can't silently drift apart.

Pure string-building: no database, no network, runs in milliseconds.
"""
from pathlib import Path

from src.onboarding.access_policy import build_access_policy_command

PS1 = Path(__file__).resolve().parents[1] / "scripts" / "application-access-policy.ps1"


def test_each_mailbox_appears_in_its_own_membership_line():
    mboxes = ["projects@acme.com", "deals@acme.com"]
    out = build_access_policy_command("APP-ID", "scope@acme.com", mboxes)
    cmd = out["command"]
    for m in mboxes:
        assert f'Add-DistributionGroupMember -Identity "scope@acme.com" -Member "{m}"' in cmd
    # exactly one membership line per mailbox — none dropped, none duplicated.
    assert cmd.count("Add-DistributionGroupMember") == len(mboxes)


def test_command_creates_group_and_binds_restrictaccess():
    out = build_access_policy_command("APP-ID", "scope@acme.com", ["a@acme.com"])
    cmd = out["command"]
    assert 'New-DistributionGroup -Name "scope@acme.com"' in cmd
    assert "New-ApplicationAccessPolicy -AppId APP-ID" in cmd
    assert "-AccessRight RestrictAccess" in cmd


def test_blank_and_whitespace_mailboxes_are_dropped():
    out = build_access_policy_command("APP-ID", "scope@acme.com", ["  ", "", "real@acme.com"])
    cmd = out["command"]
    assert cmd.count("Add-DistributionGroupMember") == 1
    assert '-Member "real@acme.com"' in cmd


def test_inputs_are_trimmed():
    out = build_access_policy_command("  APP-ID  ", "  scope@acme.com  ", ["  a@acme.com  "])
    cmd = out["command"]
    assert "New-ApplicationAccessPolicy -AppId APP-ID " in cmd
    assert '-Member "a@acme.com"' in cmd


def test_no_mailboxes_means_no_membership_lines_and_scope_test():
    out = build_access_policy_command("APP-ID", "scope@acme.com", [])
    assert "Add-DistributionGroupMember" not in out["command"]
    # with nothing to add, the verification targets the scope group itself.
    assert out["test_command"] == 'Test-ApplicationAccessPolicy -AppId APP-ID -Identity "scope@acme.com"'


def test_test_command_checks_every_mailbox():
    mboxes = ["a@acme.com", "b@acme.com"]
    out = build_access_policy_command("APP-ID", "scope@acme.com", mboxes)
    for m in mboxes:
        assert f'Test-ApplicationAccessPolicy -AppId APP-ID -Identity "{m}"' in out["test_command"]


def test_mailbox_value_stays_inside_one_line():
    # A stray space inside a value must not spill into a new PowerShell line.
    out = build_access_policy_command("APP-ID", "scope@acme.com", ["weird name@acme.com"])
    add_lines = [ln for ln in out["command"].splitlines() if "Add-DistributionGroupMember" in ln]
    assert len(add_lines) == 1
    assert '-Member "weird name@acme.com"' in add_lines[0]


def test_generated_command_matches_the_standalone_ps1_cmdlets():
    # Drift guard: the API generator and the hand-run script must use the same
    # Exchange cmdlets and the same RestrictAccess right. If someone edits one,
    # this fails until the other is brought in line.
    ps1 = PS1.read_text(encoding="utf-8")
    out = build_access_policy_command("APP-ID", "scope@acme.com", ["a@acme.com"])
    cmd = out["command"]
    for cmdlet in (
        "New-DistributionGroup",
        "Add-DistributionGroupMember",
        "New-ApplicationAccessPolicy",
        "RestrictAccess",
    ):
        assert cmdlet in ps1, f"{cmdlet} missing from application-access-policy.ps1"
        assert cmdlet in cmd, f"{cmdlet} missing from generated command"
