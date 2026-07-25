"""Tenancy: the control plane and per-customer database provisioning.

Indigo Iota runs database-per-tenant. This package owns:

  * the control-plane database (organizations, users, roles, the tenant
    registry, audit log), and
  * provisioning: turning "a new customer" into a real, isolated brain database
    that is migrated to head and registered in the control plane.

See ``provision.py`` for the CLI.
"""
