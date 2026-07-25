"""Ingestion: the whole flow that turns a raw communication into brain.

One process, four named phases — every email travels through them in order:

  ① capture/   — pull raw comms from the source (MS Graph delta) and normalize
                 them into a ``captured_events`` row. No LLM; pure + replayable.
  ② triage/    — decide what is allowed in. A local, embedding-only scope
                 classifier (in_scope / redzone / spam / out_of_scope) keeps
                 out-of-scope and sensitive material out of the brain. No LLM,
                 no data leaves the box.
  ③ comprehend/— the metered LLM phase: agents read each in-scope event and
                 pull out entities, relationships, timeline, descriptions and
                 judgment, then canonicalize (merge duplicates) into brain pages.
  ④ index/     — write the knowledge graph + chop pages into chunks and embed
                 them, so the brain is searchable.

Top-level drivers tie the phases together:

  - ``scheduler`` — the scheduled loop: sweep mailboxes on a cadence.
  - ``runner``    — drive comprehend+index over captured events that haven't
                    been processed yet (credit-metered, resumable).

Every phase takes an open *tenant* connection (database-per-tenant), so the
caller picks the brain DB and owns the transaction boundary.

CLI:
    python -m src.ingestion.triage.classify "some email text to classify"
    python -m src.ingestion --mailbox user@customer.com [--process]
    python -m src.ingestion --mailbox user@customer.com --from-file sample.json
"""
