# Data Security and Privacy Brief for Customers of Indigo Iota

**Version 1 · 2026 · indigo-iota.com**

> **About this document.** This brief explains, in plain language, how Indigo Iota
> handles your data and how we meet the requirements of European and German data
> protection law. It is written for the people at a consultancy who have to say
> "yes" before a tool like ours can touch client data — typically a managing
> partner, an IT lead, and a data protection officer (DPO).
>
> It is an **informational document, not legal advice**, and it is not the binding
> contract. The legally binding terms live in the **Data Processing Agreement
> (AVV)** we sign with you. Where this brief and the AVV differ, the AVV governs.
> We are happy to walk your DPO or counsel through any point in detail.

---

## 0. The situation in one paragraph

Indigo Iota is a "project brain": with your permission, it reads the emails and
files of a specific engagement, and turns them into a searchable, structured
memory of who is involved, what was decided, and what is happening — so your team
can ask questions and get answers grounded in your own material. To do that, we
necessarily process **personal data** (names, email addresses, the content of
messages) and **confidential client information**. That makes data protection not
a footnote but the core of the relationship. The rest of this document explains
the rules that apply, what we ask of you during onboarding, and the concrete
technical and organisational measures we take to keep your data safe.

---

## 1. Requirements from GDPR and the AVV (and what else applies)

This section explains *what the law requires*. Sections 2 and 3 explain *how we
meet it*.

### 1.1 The two laws that govern this

- **GDPR (General Data Protection Regulation / DSGVO).** The EU-wide regulation
  governing any processing of *personal data* — meaning any information relating
  to an identified or identifiable living person (a name, an email address, but
  also the *content* of an email that talks about a person). It applies whenever
  EU residents' data is processed, regardless of where the processor sits.
- **BDSG (Bundesdatenschutzgesetz).** Germany's national data protection act,
  which supplements the GDPR with German-specific rules (for example on employee
  data and on the appointment of data protection officers). For a German
  consultancy, GDPR + BDSG together are the baseline.

> **Note on professional secrecy (§203 StGB).** Certain professions — lawyers,
> tax advisors, auditors, doctors — are bound by criminal-law professional secrecy
> that adds requirements *on top of* the GDPR. This brief is written for a
> **management/strategy consultancy (Unternehmensberatung)**, which is generally
> **not** bound by §203 StGB. If your client work touches a regulated sector, tell
> us and we will adapt.

### 1.2 Who is who — the roles that decide everyone's duties

Data protection law assigns responsibilities by *role*. Getting these straight is
the foundation of everything else.

- **Data subject (betroffene Person).** The living person whose data is processed —
  here, your employees, your client contacts, and anyone mentioned in the emails
  and files we read.
- **Controller (Verantwortlicher) — that is *you*, the consultancy.** The party
  that decides *why* and *how* personal data is processed. You decide that this
  data should be made searchable by Indigo Iota, for which engagement, and for
  which users. In law, you carry primary responsibility toward the data subjects.
- **Processor (Auftragsverarbeiter) — that is *us*, Indigo Iota.** A party that
  processes personal data **only on the controller's documented instructions**, on
  your behalf. We do not decide the purposes; we execute the service you
  configured. We never use your data for our own ends (no training of general
  models on it, no resale, no profiling for us).
- **Sub-processor (Unterauftragsverarbeiter).** A third party *we* rely on that
  also touches the data — for example a hosting provider. These must be disclosed
  to you, bound by equivalent obligations, and are subject to your right to object.
  Our current sub-processors are listed in §3.

### 1.3 The core principles the GDPR demands (Art. 5)

Every processing activity must satisfy these. We restate them here because they
shape our whole design:

1. **Lawfulness, fairness, transparency.** There must be a valid legal basis
   (Art. 6), and people must be able to know, in principle, that this processing
   happens. Establishing the legal basis and informing data subjects is the
   **controller's** duty (you); we support it.
2. **Purpose limitation.** Data may be used only for the specific, declared
   purpose — running the project brain for the agreed engagement — and not
   repurposed.
3. **Data minimisation.** Only data that is *necessary* for the purpose may be
   processed. This is why we connect to **narrow, named** mailboxes and folders
   rather than "everything," and why we retain as little raw content as possible
   (see §3).
4. **Accuracy.** Data should be correct and current; there must be a way to
   correct or delete wrong data.
5. **Storage limitation.** Data may be kept only as long as needed for the
   purpose, then deleted. We implement explicit retention windows and deletion.
6. **Integrity and confidentiality (security).** Data must be protected against
   unauthorised access, loss, or alteration through appropriate technical and
   organisational measures (this is expanded in Art. 32; see §3).
7. **Accountability.** The controller — and by extension the processor — must be
   able to *demonstrate* compliance, not merely assert it. Hence documentation,
   records of processing, and this brief.

### 1.4 The legal basis for processing (Art. 6)

Personal data may only be processed if at least one legal basis applies — commonly
**legitimate interests (Art. 6(1)(f))** for B2B project work, or **contract
performance**, sometimes **consent**. Choosing and documenting the legal basis is
the **controller's** responsibility. As your processor, we rely on your
instruction that a basis exists; we are glad to provide the technical description
of processing that your DPO needs to complete that assessment.

### 1.5 The AVV — the contract that makes processing lawful (Art. 28)

Whenever a controller lets a processor handle personal data, Art. 28 GDPR
**requires a written contract** — in German practice the
**Auftragsverarbeitungsvertrag (AVV)**, in English a Data Processing Agreement
(DPA). Without it, the processing is unlawful regardless of how good the security
is. The AVV must, by law, set out:

- the **subject matter, duration, nature and purpose** of the processing;
- the **types of personal data** and **categories of data subjects** involved;
- the **obligations and rights of the controller**; and
- a set of **mandatory processor obligations**, namely that the processor will:
  - **(a)** process only on the controller's **documented instructions**;
  - **(b)** ensure that people authorised to process the data are under a duty of
    **confidentiality**;
  - **(c)** implement the **security measures** required by Art. 32;
  - **(d)** engage **sub-processors** only under the same conditions and with the
    controller's authorisation;
  - **(e)** **assist** the controller in responding to **data-subject-rights**
    requests (§1.6);
  - **(f)** **assist** the controller with security, breach notification, and
    impact assessments (Art. 32–36);
  - **(g)** **delete or return** all personal data at the end of the engagement;
  - **(h)** make available the information needed to demonstrate compliance and
    **allow audits**.

We provide a ready AVV template embodying all of the above, so your legal review
is a single pass rather than a negotiation from scratch.

### 1.6 The rights of data subjects (Art. 12–23)

Individuals have enforceable rights, which the controller must honour and the
processor must help fulfil:

- **Access (Art. 15)** — what data is held about them.
- **Rectification (Art. 16)** — correction of inaccurate data.
- **Erasure / "right to be forgotten" (Art. 17)** — deletion on valid request.
- **Restriction (Art. 18)** — pausing processing in dispute.
- **Data portability (Art. 20)** — receiving their data in a usable format.
- **Objection (Art. 21)** — objecting to processing based on legitimate interests.

Because *you* hold the relationship with the data subject, these requests come to
you; our job is to make them **technically executable** — find, export, correct,
or delete the relevant data quickly (see deletion tooling in §3).

### 1.7 Security of processing (Art. 32) — "TOMs"

Art. 32 requires "appropriate technical and organisational measures"
(**technische und organisatorische Maßnahmen, TOMs**) proportionate to the risk,
explicitly mentioning encryption, pseudonymisation, confidentiality, integrity,
availability, resilience, and regular testing. Our full TOM list is §3 and is also
an annex to the AVV.

### 1.8 Breach notification (Art. 33–34)

If personal data is breached, the controller must notify the supervisory authority
**within 72 hours**, and affected individuals if the risk is high. As processor we
must notify *you* **without undue delay** so you can meet that clock. Our incident
process (§3) is built around this.

### 1.9 International data transfers (Chapter V, Art. 44–50)

Sending personal data outside the EU/EEA is only lawful with specific safeguards
(an adequacy decision, **Standard Contractual Clauses (SCCs)**, etc.). The
simplest, strongest position — and the one German customers expect — is to **not
transfer the data outside the EU at all**. We host and process within the EU and
avoid US-controlled infrastructure, which removes this entire category of risk
(including the unsettled status of the EU–US Data Privacy Framework). See §3.

### 1.10 Additional requirements beyond the letter of the law

- **Data residency expectations.** Many German clients contractually require
  EU — often specifically German — hosting, beyond what the GDPR strictly mandates.
- **Data protection by design and by default (Art. 25).** Privacy must be built
  into the architecture, not bolted on. Our minimisation-by-architecture choices
  (§3) are a direct response.
- **Records of processing (Art. 30).** Both parties must keep an inventory of
  processing activities; we maintain ours and supply what you need for yours.
- **Your own confidentiality duties.** Independently of data protection law, you
  likely owe your clients **contractual confidentiality**. Our narrow-scope,
  EU-only, no-third-party-AI design is built to let you keep those promises.

---

## 2. Considerations for the onboarding process with Indigo Iota

This section translates the rules above into the practical decisions and steps of
getting started. The guiding principle is the GDPR's own: **collect the least,
scope the narrowest, decide on purpose.**

### 2.1 Sign the AVV first

Before any data is connected, we sign the **AVV** (§1.5). This is both a legal
prerequisite and the document in which we jointly record the *scope, purpose, data
types, and data subjects* for your engagement. Nothing is read before it is in
place.

### 2.2 Define a deliberately narrow scope (data minimisation in practice)

Together we decide exactly **which engagement(s)**, **which mailboxes** (or a
single shared project mailbox), and **which SharePoint sites/folders** Indigo Iota
may read. We deliberately keep customer #1 small. Equally important, we record
**what is off-limits** — HR, legal, sensitive clients — so those are never
connected. Knowing what *not* to touch is part of the configuration, not an
afterthought.

### 2.3 Understand the access model — read-only, narrow, revocable

We connect to Microsoft 365 through **Microsoft Graph**, Microsoft's single secure
gateway to your data, using the **least-privilege** permissions:

- **Files:** `Sites.Selected` — the application starts with **zero** access and
  can reach **only** the specific SharePoint sites your admin explicitly grants.
- **Email:** `Mail.Read` (read-only) constrained by an **Application Access
  Policy** that limits us to the **named mailboxes** you choose — not the whole
  organisation.
- We authenticate as an application using a **certificate** (a tamper-resistant
  digital ID), never a password, via the **client-credentials flow**. You hand us
  no credentials of your own.

All access is **read-only** and can be **revoked by your admin at any time** by
withdrawing consent or removing the grant.

### 2.4 Plan for the admin approval (one clean pass)

Only a **global administrator** of your Microsoft 365 tenant can approve
application access. The person championing the project is often not that admin, so
we plan for this early. We provide a **plain-English security summary** (the
"send-this-to-your-IT-admin" sheet) *before* the call, and we request all needed
permission *types* in a single setup so there is **no need to return** to the admin
to repeat the registration later — adding a further mailbox or site afterwards is a
lightweight configuration change, not a new approval.

### 2.5 Confirm the legal basis and inform data subjects

As controller, you confirm the **legal basis** (§1.4) and ensure the relevant
people (your team, and as appropriate your client contacts) are **informed** that
this processing takes place, through your existing privacy notices. We supply the
precise description of what we process so your notice is accurate.

### 2.6 Decide who sees what

For a first pilot we recommend the simplest, safest default: **everyone on the
project sees the same project brain**, walled off completely from every other
customer. Finer-grained, per-person visibility *within* your firm can be added
later — we just decide it on purpose rather than by accident.

### 2.7 Approve sub-processors and data location

You review and approve our short **sub-processor list** and confirm the
**data-residency** choice (EU / Germany). Both are recorded in the AVV.

### 2.8 Agree retention and deletion up front

We agree how long raw content is retained and confirm that, at any time and at the
end of the engagement, your data can be **fully deleted or returned** (§1.5(g),
§1.6 erasure). This is decided before import, not improvised later.

### 2.9 Estimate volume and run a watched first import

We estimate rough volume (file counts, mailbox sizes) to size the initial copy,
then run the first import **together, watched**, and fix anything that surprises
us. The goal of onboarding is the first **"wow"** — the brain answering a real
question on your own data — achieved with the minimum data necessary.

---

## 3. How Indigo Iota ensures compliance — our security measures (TOMs) in detail

This is our **technical and organisational measures (TOM)** catalogue under
Art. 32. It is reproduced as an annex to the AVV. Each measure is explained so a
non-specialist can understand both *what* it is and *why* it protects you.

### 3.1 Data residency — your data stays in the EU

**What:** All storage and processing happens on infrastructure located in the
**European Union**, specifically **[Germany — Hetzner Online GmbH, Falkenstein /
Nuremberg data centres (to be confirmed in the AVV annex)]**. We deliberately avoid
infrastructure controlled by non-EU providers.

**Why it matters:** Keeping data inside the EU removes the legal complexity and
risk of international transfers (§1.9) entirely — there is no exposure to foreign
government access regimes such as the US CLOUD Act, and no reliance on contested
mechanisms like the EU–US Data Privacy Framework. For a German consultancy this is
often the single most important assurance.

### 3.2 Read-only, narrow, certificate-based source access

**What:** As described in §2.3 — `Sites.Selected` for files, `Mail.Read` plus an
Application Access Policy for email, authenticated by **certificate** via the
**client-credentials flow**, all **read-only** and revocable.

**Why:** We can only ever read the specific mailboxes and folders you choose, we
can never write or delete in your systems, and there is no password of yours for
anyone to steal. The narrow scope is enforced by Microsoft itself, not merely by
our good behaviour.

### 3.3 Encryption in transit (TLS)

**What:** Every connection — between Microsoft and us, between your browser and our
application, and between our internal services — is protected with **Transport
Layer Security (TLS)**, the same encryption that secures online banking.

**Why:** It makes the data unreadable to anyone who might intercept it while it
travels across networks.

### 3.4 Encryption at rest

**What:** Data stored on disk — the database, file content, and backups — is
**encrypted at rest** using strong, industry-standard encryption
**[AES-256; volume-level and, where applicable, database-level]**.

**Why:** If a physical disk or a backup file were ever stolen or improperly
accessed, its contents would be unintelligible without the keys.

### 3.5 Strict customer isolation — Row-Level Security (RLS)

**What:** Your data and every other customer's data live in the same managed
PostgreSQL database, but are kept rigorously separated by **Row-Level Security
(RLS)**. RLS makes the **database itself** stamp every record with its owner and
**refuse to return records that do not belong to the requester** — enforcement
happens in the database engine, beneath the application, so it holds **even if the
application code had a bug**. We also follow the two well-known RLS precautions:
the application connects with a **restricted, non-owner role** (the database owner
account would otherwise bypass RLS), and enforcement is **explicitly switched on**
and tested.

**Why:** It is a structural guarantee — like a filing cabinet in which no customer
can ever open another customer's drawer — rather than a promise that the software
will behave.

### 3.6 Least-privilege access and role separation

**What:** Internal components and database connections run with the **minimum
privileges** necessary. The product never connects as an administrative or owner
account for ordinary queries. Administrative access to infrastructure is limited to
named individuals on a **need-to-know** basis.

**Why:** It limits the blast radius of any single compromised credential or bug.

### 3.7 Local, self-hosted embeddings — no third-party AI sees your data for search

**What:** To let you search "by meaning," Indigo Iota converts text into
**embeddings** — numerical representations where similar meanings sit close
together, like coordinates for ideas — stored and searched inside PostgreSQL via
the **pgvector** extension. Crucially, we generate these embeddings with a model
that runs **on our own EU infrastructure** (**[BAAI/bge-small-en-v1.5 via
fastembed]**). **No external AI service is involved in this step.**

**Why:** The single most common privacy concern with AI products is "where does my
text go to be processed?" For the search/indexing layer, the answer is: **nowhere —
it never leaves our EU systems.** There is no embedding sub-processor to disclose
or worry about.

### 3.8 EU-hosted language model for extraction — a single, disclosed sub-processor

**What:** To read messages and build the structured brain (identifying people,
companies, decisions, timelines), we use a **large language model** hosted by
**[LLMBase, an EU-based, GDPR-compliant inference provider running an open-weight
model, openai/gpt-oss-120b]**. This is the **one** sub-processor that processes
content, it is **EU-based**, it operates under a **data processing agreement** with
us, and it does **not** train on or retain your data.

**Why:** We are transparent that *some* AI processing of content occurs, we keep it
**in the EU**, we keep it to **one** named provider, and we contractually forbid
secondary use. If even this is a concern for you, we can discuss a self-hosted
model option.

### 3.9 Data minimisation by architecture — we keep raw content only briefly

**What:** Raw emails and files are processed into the minimised, structured
"brain." We hold the **raw source content only transiently**, under an explicit
**retention window [default: raw source events are purged N days after
extraction]**, after which only the derived, minimised representation remains. We
store the least we can while still delivering the service.

**Why:** This is **data protection by design** (Art. 25) and **storage limitation**
(Art. 5(1)(e)) made concrete. Holding less of your clients' raw correspondence
means a smaller attack surface, lower breach impact, and simpler erasure.

### 3.10 Deletion and return on demand

**What:** We provide tooling to **delete all of a customer's data** on request and
on contract termination, and to **export/return** it. Deletion propagates to
backups within the backup-retention cycle.

**Why:** It operationalises the **right to erasure** (Art. 17) and the AVV's
end-of-engagement duty (Art. 28(3)(g)). You are never locked in, and a data
subject's deletion request can actually be carried out.

### 3.11 Backups — EU-located, encrypted, deletable

**What:** Backups are taken to ensure availability and resilience, stored
**encrypted** and **within the EU**, with a defined **retention period
[to be confirmed]**, and are included in deletion.

**Why:** Backups protect you against data loss (an Art. 32 "availability"
requirement) without becoming a hidden copy that escapes your control.

### 3.12 Access control and audit logging within the product

**What:** Access to the application requires authentication; user access reflects
the **agreed visibility model** (§2.6). We maintain **audit logs** of significant
access and administrative actions.

**Why:** It ensures only authorised people see the brain, and it provides the
**accountability** trail (Art. 5(2)) needed to investigate and demonstrate proper
handling.

### 3.13 Pseudonymisation where feasible

**What:** Where it does not defeat the purpose of the service, we apply
**pseudonymisation** (separating direct identifiers from content).

**Why:** Art. 32 names it explicitly as a risk-reducing measure; it limits the
damage if any single store is exposed.

### 3.14 Breach detection and notification

**What:** We monitor for anomalies and maintain a documented **incident response
plan**. On any personal-data breach we notify **you without undue delay**, with the
information you need to meet your **72-hour** authority-notification duty
(Art. 33), and we support any communication to affected individuals (Art. 34).

**Why:** The 72-hour clock is unforgiving; our process is built so you can meet it.

### 3.15 Confidentiality obligations and staff

**What:** Everyone at Indigo Iota with potential access to customer data is bound
by **written confidentiality obligations** and works on a **need-to-know** basis.

**Why:** Art. 28(3)(b) requires it, and it is the organisational counterpart to the
technical controls.

### 3.16 Sub-processor governance

**What:** We maintain the **current sub-processor list** (today: **[EU hosting
provider]** for infrastructure and **[LLMBase]** for extraction; embeddings are
**in-house, not a sub-processor**). New sub-processors are added only under
equivalent obligations and with **prior notice and your right to object**.

**Why:** It satisfies Art. 28(2)/(4) and keeps you in control of who can ever touch
your data.

### 3.17 Records of processing and audit support

**What:** We keep our **records of processing activities** (Art. 30) and make
available the documentation — this brief, the TOM annex, the sub-processor list —
needed for your records and for any **audit** you are entitled to conduct
(Art. 28(3)(h)).

**Why:** Compliance must be **demonstrable**, not just asserted; we give you the
evidence.

### 3.18 Privacy and security by design in development

**What:** Security and minimisation are design criteria in how we build, not
afterthoughts: dependency hygiene, least-privilege defaults, and review of changes
that affect data handling.

**Why:** Art. 25 expects privacy to be engineered in from the start — which is
exactly how the measures above came to exist.

---

## Appendix A — Glossary of key terms

- **GDPR / DSGVO** — the EU General Data Protection Regulation.
- **BDSG** — Germany's national Federal Data Protection Act, supplementing the GDPR.
- **Personal data** — any information relating to an identifiable living person.
- **Data subject** — the person the data is about.
- **Controller (Verantwortlicher)** — decides why/how data is processed (you).
- **Processor (Auftragsverarbeiter)** — processes on the controller's instructions
  (Indigo Iota).
- **Sub-processor** — a third party the processor uses that also touches the data.
- **AVV / DPA** — the legally required data processing contract (Art. 28).
- **TOMs** — technical and organisational security measures (Art. 32).
- **Legal basis** — the lawful ground for processing (Art. 6).
- **Data minimisation** — using only the data necessary for the purpose.
- **Storage limitation** — keeping data only as long as necessary.
- **Right to erasure** — the data subject's right to have data deleted (Art. 17).
- **Microsoft Graph** — Microsoft's single API gateway to Microsoft 365 data.
- **Application permission / client-credentials flow** — an app acting as itself,
  approved by an admin, with no user logged in.
- **`Sites.Selected`** — a permission granting access only to explicitly chosen
  SharePoint sites.
- **Application Access Policy** — an Exchange control limiting an app's mail access
  to named mailboxes.
- **Encryption in transit / at rest** — protecting data while it travels / while it
  is stored.
- **Row-Level Security (RLS)** — database-enforced separation so each customer can
  see only its own rows.
- **Embeddings / pgvector** — numerical "meaning coordinates" enabling search by
  meaning, stored in PostgreSQL via the pgvector extension.
- **SCCs / Data Privacy Framework** — mechanisms for lawful non-EU data transfers
  (which we avoid by staying EU-only).

---

## Appendix B — What we need from you (onboarding checklist)

1. Your Microsoft 365 domain and the **global admin** who can approve access.
2. The **one or two engagements** to pilot.
3. The specific **SharePoint sites/folders** for those engagements.
4. The specific **mailboxes** (or a shared project mailbox).
5. What is **off-limits** (HR, legal, sensitive clients).
6. The **end users** and whether all should see the same project brain.
7. Any **data-location / compliance** requirements (confirmed: EU / Germany).
8. Rough **volume** (file counts, mailbox sizes) to size the first import.

---

*Indigo Iota · indigo-iota.com · [Legal entity, address] · Contact for data
protection enquiries: [privacy@indigo-iota.com / DPO contact]. This brief is
informational and does not replace the binding AVV. Bracketed items are confirmed
per customer in the AVV and its annexes.*
