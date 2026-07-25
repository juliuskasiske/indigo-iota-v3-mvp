<#
.SYNOPSIS
    Restrict the Indigo Iota mail Connector app so it can read ONLY the
    in-scope mailbox(es) — never the whole tenant.

.DESCRIPTION
    By default an Entra application with the Mail.Read APPLICATION permission
    can read EVERY mailbox in the tenant. That is far more than a project brain
    needs. An Application Access Policy (Exchange Online) pins the app to a
    single mail-enabled security group, so it can only touch members of that
    group. This is the customer-side guardrail referenced in the onboarding.

    Run this as an Exchange Online administrator AFTER the customer admin has
    granted admin consent to the Connector app.

.PARAMETER ConnectorAppId
    The Connector app's Application (client) ID — the one with Mail.Read.

.PARAMETER ScopeGroup
    Address of the mail-enabled security group that lists the in-scope
    mailbox(es), e.g. indigo-iota-scope@customer.com. Created if missing.

.PARAMETER InScopeMailboxes
    One or more mailbox addresses to place in the scope group.

.PARAMETER OutOfScopeMailbox
    Optional: a mailbox you expect to be DENIED, used to prove the policy bites.

.EXAMPLE
    .\application-access-policy.ps1 `
        -ConnectorAppId "00000000-1111-2222-3333-444444444444" `
        -ScopeGroup "indigo-iota-scope@customer.com" `
        -InScopeMailboxes "projects@customer.com" `
        -OutOfScopeMailbox "ceo@customer.com"
#>
param(
    [Parameter(Mandatory = $true)] [string]   $ConnectorAppId,
    [Parameter(Mandatory = $true)] [string]   $ScopeGroup,
    [Parameter(Mandatory = $true)] [string[]] $InScopeMailboxes,
    [Parameter(Mandatory = $false)][string]   $OutOfScopeMailbox
)

$ErrorActionPreference = "Stop"

# 1. Connect to Exchange Online (prompts for an Exchange admin sign-in).
if (-not (Get-Module -ListAvailable -Name ExchangeOnlineManagement)) {
    Write-Host "Installing ExchangeOnlineManagement module..."
    Install-Module ExchangeOnlineManagement -Scope CurrentUser -Force
}
Import-Module ExchangeOnlineManagement
Connect-ExchangeOnline

# 2. Ensure the mail-enabled security group exists and lists the in-scope boxes.
$existing = Get-DistributionGroup -Identity $ScopeGroup -ErrorAction SilentlyContinue
if (-not $existing) {
    Write-Host "Creating scope group $ScopeGroup ..."
    New-DistributionGroup -Name $ScopeGroup -PrimarySmtpAddress $ScopeGroup `
        -Type Security | Out-Null
}
foreach ($mbx in $InScopeMailboxes) {
    Write-Host "Adding $mbx to $ScopeGroup ..."
    Add-DistributionGroupMember -Identity $ScopeGroup -Member $mbx `
        -ErrorAction SilentlyContinue
}

# 3. Create the restricting policy: the app may ONLY access group members.
Write-Host "Creating Application Access Policy (RestrictAccess) ..."
New-ApplicationAccessPolicy `
    -AppId $ConnectorAppId `
    -PolicyScopeGroupId $ScopeGroup `
    -AccessRight RestrictAccess `
    -Description "Limit Indigo Iota connector to in-scope mailboxes" | Out-Null

# Policy propagation can take a few minutes across Exchange Online.
Write-Host "Policy created. Allow a few minutes for it to propagate."

# 4. Prove it: in-scope is granted, out-of-scope is denied.
Write-Host "`n--- Verification ---"
foreach ($mbx in $InScopeMailboxes) {
    $r = Test-ApplicationAccessPolicy -AppId $ConnectorAppId -Identity $mbx
    Write-Host ("IN-SCOPE  {0,-35} AccessCheckResult = {1}" -f $mbx, $r.AccessCheckResult)
}
if ($OutOfScopeMailbox) {
    $r = Test-ApplicationAccessPolicy -AppId $ConnectorAppId -Identity $OutOfScopeMailbox
    Write-Host ("OUT-SCOPE {0,-35} AccessCheckResult = {1} (expect: Denied)" -f $OutOfScopeMailbox, $r.AccessCheckResult)
}

Write-Host "`nDone. In-scope mailboxes should read 'Granted'; others 'Denied'."
Disconnect-ExchangeOnline -Confirm:$false
