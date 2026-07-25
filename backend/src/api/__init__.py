"""The Indigo Iota product API (multi-tenant, control-plane backed).

Distinct from src/dashboard, which is the single-database 'brain graph' demo.
This app authenticates users via EntraID SSO, resolves their organization + role
from the control plane, and will host the Admin Center and tenant-aware brain
routes. Run it with:

    uvicorn src.api.app:app --reload --port 8099
"""
