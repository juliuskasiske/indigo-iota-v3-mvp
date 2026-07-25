"""Customer onboarding: turn a fresh Entra tenant into a working login + mail
connector, with as little customer effort as possible.

The hard parts (the OIDC flow, the Graph delta client, the scope gate) are
already built. Onboarding is the glue: get the customer's admin to *consent*,
wire their tenant into our control plane, and prove it works.

App-registration model (two multi-tenant apps in OUR tenant — least privilege):

  * "Login" app  — delegated openid/profile/email only. Powers SSO. Can NOT
    read mail. A leaked login secret exposes nothing but sign-in.
  * "Connector" app — application permission Mail.Read, certificate auth, no
    user login. Reads mail app-only, and is constrained to specific mailboxes
    by an Application Access Policy on the customer side.

The customer admin does exactly three things, all from links/scripts we hand
over (we never touch their admin credentials):

  1. click the Login-app admin-consent URL,
  2. click the Connector-app admin-consent URL,
  3. run scripts/application-access-policy.ps1 to scope Mail.Read to the
     in-scope mailbox(es).

CLI (see __main__):
    python -m src.onboarding consent-urls --tenant-id <dir-id> \\
        --login-client-id <id> --connector-client-id <id>
    python -m src.onboarding set-sso --slug acme --tenant-id <dir-id> \\
        --client-id <login-id>   # secret is the shared SSO_CLIENT_SECRET env var
    python -m src.onboarding verify --slug acme
"""
