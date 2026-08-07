# Demo corpus — Nordwind Analytics GmbH

A fictional workspace built for one objective: **grow sales**. Everything here
is invented; no real company, person, or address appears.

The corpus is written *design-backward* from the knowledge graph we want the
brain to hold after comprehension, so the agent swarm has something real to
reason over. Read this file to know what the swarm is supposed to be able to
find.

## The company

**Nordwind Analytics GmbH** — Hamburg. Sells *Nordwind Signal*, a supply-chain
analytics platform, to mid-market manufacturers and logistics operators in DACH
and the Nordics. ~€6.2M ARR, 42 people, average ACV €78k.

## Cast

Internal (`@nordwind-analytics.de`)

| Person | Role |
|---|---|
| Bernd Kolthoff | CEO |
| Lena Brandt | VP Sales |
| Ralf Neumann | CFO |
| Priya Raman | Account Executive, DACH enterprise |
| Tomas Ek | Account Executive, Nordics (Stockholm) |
| Jonas Weiss | SDR team lead |
| Katrin Sölle | Head of Customer Success |
| Marek Dvorak | Solutions Engineer (pre-sales) |
| Sophie Lindqvist | Head of Marketing / demand gen |
| Ana Costa | Head of Product |

External

| Company | Contact | Situation |
|---|---|---|
| Hafenlogistik Bremen AG | Ingo Petersen (COO), Miriam Falk (Head of Ops) | Customer; €180k expansion pending |
| Vestholm Foods A/S (DK) | Line Bruun (Supply Chain Dir.), Anders Holm (CFO) | Open €240k deal, competitive |
| Kranz Pharma GmbH | Dr. Ulrike Hentschel (Procurement), Milan Radić (Security) | Pilot stalled in security review |
| Alpenmetall AG (AT) | Georg Steiner (IT Director) | €95k at churn risk, failed integration |
| Nordfracht Oslo AS (NO) | Kristine Dahl (CEO) | Lost — no Norwegian UI, no local reference |
| Steinbeck Automotive GmbH | Uwe Bartsch (Head of Logistics) | Lost to Kestrel on price + SAP connector |
| Meyerhof Textil GmbH | Claudia Meyerhof (Owner) | SMB customer, €14k ACV, high support load |
| Blaubaum Consulting | Henrik Blaubaum (Partner) | SI partner, 7 referrals, 0% rev share |
| Kestrel Supply IQ (US) | — | Main competitor; ~15% cheaper, SAP + Dynamics connectors |
| LogiTwin GmbH | — | Low-cost local competitor |

## The eight value leaks the corpus encodes

Each one is stated across *several* emails plus at least one document, with
consistent numbers, so a validator agent can corroborate it rather than take a
single sentence's word for it.

1. **Discount leakage** — policy caps discount at 12%; H1 average was 19.4%,
   with 14 of 23 closed deals taking an exception. ~€412k of annualized gross
   margin.
2. **Security-review drag** — no ISO 27001; every enterprise deal loses 6–11
   weeks to questionnaires answered from scratch. Kranz Pharma (€140k) is the
   live example; cycle 94 → 148 days.
3. **Nordics localization gap** — no Norwegian/Danish UI and no local reference
   customer. Nordfracht lost; Vestholm (€240k) at risk.
4. **SDR → AE handoff leakage** — 612 MQLs in Q2, 38% never worked inside five
   business days, 34h average first response.
5. **Churn / onboarding** — Alpenmetall's integration was never finished; €95k
   at risk, CS looped in only after go-live. Gross churn 11%, NRR 96%.
6. **Expansion is under-incentivized** — comp plan pays 10% on new logo and 3%
   on expansion, so the €180k Hafenlogistik expansion sits unworked.
7. **Partner channel unpaid** — Blaubaum sent 7 referrals for 0% rev share and
   has started leading with Kestrel.
8. **Segment mismatch / pricing model** — SMB takes 46% of marketing spend for
   9% of ARR (CAC payback 21 months); per-seat pricing is gamed with shared
   logins where per-shipment would fit.

## Files

- `emails.py` — 27 emails (25 in scope; one HR compensation thread and one
  conference newsletter are there to prove the triage gate excludes them).
- `documents/` — six documents that carry the hard numbers.
- `seed_demo.py` — loads both into a tenant brain: capture → triage → store,
  then comprehend + index. See the module docstring for usage.
