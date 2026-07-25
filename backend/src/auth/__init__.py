"""Authentication: EntraID (OIDC) single sign-on + session management.

The backend owns the whole login: it runs the OIDC authorization-code flow
against the customer's Entra tenant, validates the ID token, maps the user to an
organization + role from the control plane, and issues a signed session cookie.
The Next.js frontend never sees a Microsoft token — it just calls the API and
the session cookie rides along.

Modules:
    sessions  signed session + login-transaction cookies (pyjwt, HS256)
    oidc      the OIDC dance: discovery, auth URL, code exchange, token validation
    service   control-plane lookups: SSO config, user upsert, role resolution
"""
