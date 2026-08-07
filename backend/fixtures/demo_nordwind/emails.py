"""The Nordwind Analytics demo mailbox: 27 invented emails.

Everything is fictional. The threads are written so that each value leak listed
in README.md is stated more than once, by more than one person, with numbers
that agree — a validator agent should be able to corroborate a hypothesis from
two independent messages plus a document, not just one throwaway line.

Shape per email (kept deliberately close to what the connector normalizes to):

    id, thread, date (ISO-8601 UTC), frm ("Name <addr>"), to [...], cc [...],
    subject, body

``seed_demo.py`` turns these into NormalizedCapturedEvent objects and runs them
through the real capture → triage → comprehend path.
"""

MAILBOX = "sales-ops@nordwind-analytics.de"

# --- the cast, as addresses -------------------------------------------------
BERND = "Bernd Kolthoff <bernd.kolthoff@nordwind-analytics.de>"
LENA = "Lena Brandt <lena.brandt@nordwind-analytics.de>"
RALF = "Ralf Neumann <ralf.neumann@nordwind-analytics.de>"
PRIYA = "Priya Raman <priya.raman@nordwind-analytics.de>"
TOMAS = "Tomas Ek <tomas.ek@nordwind-analytics.de>"
JONAS = "Jonas Weiss <jonas.weiss@nordwind-analytics.de>"
KATRIN = "Katrin Sölle <katrin.soelle@nordwind-analytics.de>"
MAREK = "Marek Dvorak <marek.dvorak@nordwind-analytics.de>"
SOPHIE = "Sophie Lindqvist <sophie.lindqvist@nordwind-analytics.de>"
ANA = "Ana Costa <ana.costa@nordwind-analytics.de>"
SALESOPS = "Sales Ops <sales-ops@nordwind-analytics.de>"

INGO = "Ingo Petersen <i.petersen@hafenlogistik-bremen.de>"
MIRIAM = "Miriam Falk <m.falk@hafenlogistik-bremen.de>"
LINE = "Line Bruun <line.bruun@vestholmfoods.dk>"
ANDERS = "Anders Holm <anders.holm@vestholmfoods.dk>"
ULRIKE = "Dr. Ulrike Hentschel <u.hentschel@kranz-pharma.de>"
MILAN = "Milan Radić <m.radic@kranz-pharma.de>"
GEORG = "Georg Steiner <g.steiner@alpenmetall.at>"
KRISTINE = "Kristine Dahl <kristine.dahl@nordfracht.no>"
UWE = "Uwe Bartsch <u.bartsch@steinbeck-automotive.de>"
CLAUDIA = "Claudia Meyerhof <c.meyerhof@meyerhof-textil.de>"
HENRIK = "Henrik Blaubaum <h.blaubaum@blaubaum-consulting.de>"

EMAILS = [
    # --- 1. Q1 close: the win rate slipped -----------------------------------
    dict(
        id="nw-0001", thread="thr-q1-close", date="2026-04-16T07:42:00Z",
        frm=LENA, to=[BERND, RALF], cc=[SALESOPS],
        subject="Q1 close — we landed at €1.42M new ARR, win rate down to 22%",
        body="""Bernd, Ralf,

Q1 is closed in the CRM. Summary before Thursday's leadership call:

- New ARR: €1.42M against a €1.75M target (81%).
- Closed-won: 11 deals. Closed-lost: 39. Win rate 22%, down from 31% in Q4.
- Average ACV: €78k. Average sales cycle: 94 days (Q4: 81 days).
- Total ARR now €6.2M.

The win rate is the number that worries me. We are not losing on product in the
demos — Marek's demo-to-proposal conversion is still 64%. We are losing after the
proposal goes out: on price, on procurement, and on two Nordics deals where we
simply could not show a local reference.

I want to bring a proper diagnosis to the leadership call rather than a feeling.
Priya and Tomas are pulling their loss reasons together.

Lena""",
    ),

    # --- 2. CFO: discounting is eating margin --------------------------------
    dict(
        id="nw-0002", thread="thr-discount", date="2026-04-21T15:10:00Z",
        frm=RALF, to=[LENA, BERND], cc=[],
        subject="Discounting is eating our gross margin",
        body="""Lena,

I went through every signed order form from H1 with the controlling team. The
pattern is not subtle.

- Our list price discount cap is 12% (Pricing & Discount Policy v3, section 4).
- The average discount actually granted on closed-won deals in H1 was 19.4%.
- 14 of the 23 closed deals carried an exception above the cap. Six were above
  25%. The largest was 31% (Meyerhof Textil, a €14k deal — we spent more
  approving it than it earns us in a year).
- Every exception was approved after the fact, by email, by whoever was around.
  There is no gate.

Annualized, the gap between the 12% policy and the 19.4% reality is about €412k
of gross margin on H1 volumes alone. That is roughly two engineers.

I am not arguing for a hard no. I am arguing that a discount above 12% should
require a written reason and a name, before the quote goes out, not after.

Ralf""",
    ),

    # --- 3. VP Sales proposes an approval gate (that never gets built) -------
    dict(
        id="nw-0003", thread="thr-discount", date="2026-04-23T09:05:00Z",
        frm=LENA, to=[PRIYA, TOMAS], cc=[RALF, SALESOPS],
        subject="Re: Discounting is eating our gross margin — new rule from May",
        body="""Priya, Tomas,

Ralf's numbers are right and we have to fix this. From 1 May:

1. Anything up to 12% you own — no approval needed.
2. 12–20% needs my written approval BEFORE the quote goes to the customer, with
   one line on why (competitive, multi-year, reference value).
3. Above 20% needs Ralf as well.

I know what you will both say: Kestrel comes in about 15% under us and the fast
way to win is to match them. But we are matching a US vendor's list price with
our margin, and we are doing it on deals where they were never going to buy from
Kestrel anyway.

Sales Ops: please add the reason field to the quote template. I want to be able
to read back, at the end of Q3, why every exception was granted.

Lena""",
    ),

    # --- 4. Kranz Pharma stuck in security review ---------------------------
    dict(
        id="nw-0004", thread="thr-kranz", date="2026-05-04T11:20:00Z",
        frm=PRIYA, to=[LENA], cc=[MAREK],
        subject="Kranz Pharma — eight weeks in security review, no end in sight",
        body="""Lena,

Kranz Pharma (€140k, 3-year term, would be our largest pharma logo) has now been
in their vendor security review for eight weeks. The commercial side is done —
Dr. Hentschel in procurement told me in April the business case is approved.

What is holding it:
- A 214-question security questionnaire. Marek and I are answering it from
  scratch in a spreadsheet, again.
- They want ISO 27001. We do not have it. We keep offering our pen-test report
  instead and it keeps not being enough.
- Their DPA template needs sub-processor detail we have never written down, so
  legal turnaround on our side is two weeks per iteration.

This is the third enterprise deal this year that has gone the same way. Deals
without a security review close in about 94 days. The ones with a security review
are averaging 148 days. That is not a deal problem, it is a company problem.

Priya""",
    ),

    # --- 5. The customer's own security ask (external voice) ----------------
    dict(
        id="nw-0005", thread="thr-kranz", date="2026-05-06T13:45:00Z",
        frm=ULRIKE, to=[PRIYA], cc=[MILAN],
        subject="Nordwind Signal — vendor assessment, outstanding items",
        body="""Dear Ms Raman,

Thank you for the revised documents. My colleague Mr Radić has reviewed them and
we still have three open items before the assessment can be signed off:

1. An ISO 27001 certificate, or an equivalent independently audited attestation.
   Our group policy requires one for any system that touches shipment data. A
   penetration test report is unfortunately not a substitute.
2. The sub-processor list with the processing location of each, as an annex to
   the DPA.
3. Confirmation in writing that production data stays inside the EU.

I would like to be candid: the commercial case for Nordwind Signal is approved on
our side and I would prefer not to lose the budget line. But our security team
will not sign without item 1, and the budget is committed for this fiscal year
only. If the certificate is not achievable, please tell me now so we can look at
the alternatives.

With kind regards,
Dr. Ulrike Hentschel
Head of Procurement, Kranz Pharma GmbH""",
    ),

    # --- 6. The solutions engineer names the repeated work ------------------
    dict(
        id="nw-0006", thread="thr-kranz", date="2026-05-08T08:30:00Z",
        frm=MAREK, to=[PRIYA, ANA], cc=[LENA],
        subject="Re: Kranz Pharma — we are answering the same questionnaire for the fourth time",
        body="""Priya, Ana,

Some numbers on the security-review work, because I think we are quietly
spending a lot of engineering time on it.

I have answered four of these questionnaires this year: Kranz (214 questions),
Steinbeck (180), Hafenlogistik's renewal review (96) and Vestholm's pre-screen
(120). Each one takes me between two and three days, and roughly 70% of the
questions repeat almost word for word across all four.

That is about ten engineer-days a quarter spent retyping the same answers, plus
the calendar time the deal spends waiting for me.

Two things would kill most of it:
- A maintained answer library (one place, reviewed once a quarter).
- ISO 27001. Ana, I know it is not a product feature, but three of my four
  questionnaires stalled on exactly that certificate.

Marek""",
    ),

    # --- 7. Nordics loss: localization + no reference ------------------------
    dict(
        id="nw-0007", thread="thr-nordfracht", date="2026-05-12T16:02:00Z",
        frm=TOMAS, to=[LENA], cc=[SOPHIE],
        subject="Lost Nordfracht Oslo (€165k) — Norwegian UI and no local reference",
        body="""Lena,

Nordfracht Oslo is lost. €165k, five months of work. Kristine Dahl called me
herself, which I appreciated, and she was very direct about why.

1. The product is English-only. Their terminal staff in Oslo and Bergen do not
   work in English. She said her operations lead told her flatly that they would
   not adopt it.
2. She asked for a reference customer in Norway or Denmark. We do not have one.
   The best I could offer was Hafenlogistik in Bremen, and she said, politely,
   that Bremen is not the Nordics.

That is now four Nordics deals lost this year, and two of them named exactly
these two reasons. My open Nordics pipeline is €640k and every one of those
deals will ask the same two questions.

I am not asking for the whole product in Norwegian. I am asking for the
operational screens, and for one reference customer we are allowed to name.

Tomas""",
    ),

    # --- 8. The lost customer's own words -----------------------------------
    dict(
        id="nw-0008", thread="thr-nordfracht", date="2026-05-13T09:15:00Z",
        frm=KRISTINE, to=[TOMAS], cc=[],
        subject="Re: Nordwind Signal — our decision",
        body="""Tomas,

Thank you for a professional process — I want to be clear that this was not about
your effort or the quality of the demo.

We have decided to go with LogiTwin. Two reasons, in order of weight:

The interface is in Norwegian. Our terminal supervisors in Oslo and Bergen are the
people who would live in this system every day, and they do not want to work in
English. Your product is better on analytics; it is worse on the thing my staff
will touch at 05:00.

Second, I asked you for someone in Norway or Denmark I could call, and there was
no one. LogiTwin gave me three names in Norway, and I called two of them.

If you localize, come back to me next year. I mean that.

Kristine Dahl
CEO, Nordfracht Oslo AS""",
    ),

    # --- 9. Marketing: segment mismatch --------------------------------------
    dict(
        id="nw-0009", thread="thr-segment", date="2026-05-19T10:40:00Z",
        frm=SOPHIE, to=[LENA, BERND], cc=[RALF],
        subject="Q2 demand-gen mix — we are buying the wrong customers",
        body="""Lena, Bernd,

The Q2 spend review is uncomfortable, so here it is plainly.

- 46% of our marketing budget goes to campaigns that produce SMB leads (under 50
  employees, average ACV €14k).
- Those customers are 9% of ARR.
- Blended CAC on that segment is about €19k against a €14k first-year contract.
  Payback is 21 months, and our SMB gross churn is 17%, so a meaningful share of
  them never pay us back at all.
- Meyerhof Textil is the archetype: €14k a year, 31% discount, and Katrin tells me
  they file more support tickets than Hafenlogistik, who pay us €310k.

Meanwhile enterprise pipeline coverage for Q3 is 2.1x, and I would want 3.5x.

I can move budget. What I cannot do alone is decide that we stop selling to the
segment that makes our logo wall look busy. That is a leadership decision and I
would like it made explicitly.

Sophie""",
    ),

    # --- 10. SDR: leads never worked ----------------------------------------
    dict(
        id="nw-0010", thread="thr-handoff", date="2026-05-21T12:05:00Z",
        frm=JONAS, to=[LENA], cc=[SOPHIE],
        subject="SDR capacity — 38% of Q2 MQLs were never worked inside five days",
        body="""Lena,

You asked what happens to the leads after marketing hands them over. I pulled Q2
out of the CRM this morning.

- 612 MQLs came in during Q2.
- 234 of them (38%) had no first touch within five business days.
- Median first response time across all MQLs: 34 hours. For the ones that came in
  Friday afternoon: 61 hours.
- Of the leads we touched inside 24 hours, 14% converted to a qualified
  opportunity. Of the leads touched after five days, 3% did.

The team is three SDRs against roughly 200 leads each per quarter, and they are
also doing their own list building, which eats about a day a week per person.

If the 24-hour cohort converts at 14% and we are leaving 234 leads past five days,
the arithmetic on what we drop is not small. I would rather we route fewer leads
faster than route all of them slowly.

Jonas""",
    ),

    # --- 11. VP response on response time ------------------------------------
    dict(
        id="nw-0011", thread="thr-handoff", date="2026-05-26T08:20:00Z",
        frm=LENA, to=[JONAS, SOPHIE], cc=[BERND],
        subject="Re: SDR capacity — first response has to get under four hours",
        body="""Jonas, Sophie,

Thank you for the numbers — that is the clearest picture we have had of the
handoff.

Two decisions:

1. The target for first response on an inbound MQL is four working hours. Not
   twenty-four, not thirty-four. Jonas, tell me what routing you need to make that
   real, including weekend cover for Friday leads.
2. Sophie, until we hit that target I would rather have 300 good leads than 612.
   Please cut the lowest-converting SMB campaign and hold the budget.

Jonas, one more thing: the 14% vs 3% figure is the single most persuasive number
I have seen this quarter. Put it in front of Bernd at the H2 planning session.

Lena""",
    ),

    # --- 12. Churn risk: Alpenmetall ----------------------------------------
    dict(
        id="nw-0012", thread="thr-alpenmetall", date="2026-06-02T14:55:00Z",
        frm=KATRIN, to=[LENA, ANA], cc=[BERND],
        subject="Alpenmetall (€95k) is going to churn unless we intervene this month",
        body="""Lena, Ana,

I need to escalate Alpenmetall AG. Their renewal is 30 September and on today's
evidence they will not renew.

What happened: they signed in October, the integration with their MES was scoped
during the sales cycle as "four weeks", and it was never finished. Nine months in,
they are still exporting CSVs by hand. Georg Steiner has raised it four times.

The root cause is not the integration itself. It is that Customer Success was
first looped in eleven days AFTER the contract was signed. By then the
implementation promises had already been made in the sales cycle, by people who
were not going to deliver them, and nobody wrote them down anywhere I can see.

That is not an Alpenmetall problem. I checked: of the nine accounts we onboarded
since January, CS was involved before signature in two.

€95k is at risk here, and our gross churn is already 11%.

Katrin""",
    ),

    # --- 13. The at-risk customer escalates ---------------------------------
    dict(
        id="nw-0013", thread="thr-alpenmetall", date="2026-06-03T07:30:00Z",
        frm=GEORG, to=[KATRIN], cc=[MAREK, PRIYA],
        subject="MES integration — fourth request",
        body="""Ms Sölle,

This is the fourth time I am writing about the same subject.

We were told during the evaluation, in writing, that the connection to our MES
would take four weeks. We signed in October. It is June. My team still exports a
CSV twice a day by hand, which is exactly the manual work the system was bought
to remove.

I have to prepare the renewal recommendation for our board in September. As
things stand I cannot recommend it, and I would rather tell you that now than in
September.

If there is a realistic plan with a date on it, please send it this week.

Georg Steiner
IT Director, Alpenmetall AG""",
    ),

    # --- 14. Expansion signal from a happy customer -------------------------
    dict(
        id="nw-0014", thread="thr-hafen", date="2026-06-09T09:50:00Z",
        frm=INGO, to=[PRIYA], cc=[MIRIAM],
        subject="Rolling Nordwind Signal out to Wilhelmshaven, Cuxhaven and Emden",
        body="""Ms Raman,

Good news from our side. The Bremen terminal has been running on Nordwind Signal
for fourteen months and Miriam's team now uses it for the daily slot planning.

The board approved extending it to three more terminals — Wilhelmshaven, Cuxhaven
and Emden — in the 2026 budget. That is roughly 45 additional users and, I assume,
a considerably larger contract.

Could you send us a proposal? We would want it live before the winter peak, so
signature by the end of August would suit us.

One question we will be asked internally: our current agreement is priced per
user, and at four terminals a lot of people will need occasional access rather
than daily access. Is there a model that reflects that?

Ingo Petersen
COO, Hafenlogistik Bremen AG""",
    ),

    # --- 15. Expansion vs comp plan -----------------------------------------
    dict(
        id="nw-0015", thread="thr-hafen", date="2026-06-10T17:25:00Z",
        frm=PRIYA, to=[LENA], cc=[],
        subject="Hafenlogistik want €180k more — and I am not paid to work it",
        body="""Lena,

Hafenlogistik have asked for a proposal to extend to three more terminals. On
current pricing that is about €180k of additional ARR, on top of their €310k. It
is the cleanest expansion in the book — they came to us.

I want to be honest with you about what happened next: I looked at my comp plan
before I looked at the deal.

New logo pays 10% commission. Expansion pays 3%. So €180k of expansion earns me
€5.4k, and the same effort on a new logo earns me €18k. I have Vestholm at €240k
open at the same time. If I am rational and I am chasing a number, I work
Vestholm and I let Hafenlogistik wait.

I do not think that is what the company wants. NRR is 96% and we are all agreed
that expansion is the cheapest revenue we have. But the plan pays for something
else, so that is what gets worked.

Please tell me to work it and I will. Better: change the plan.

Priya""",
    ),

    # --- 16. Partner channel: nothing in it for the partner -----------------
    dict(
        id="nw-0016", thread="thr-partner", date="2026-06-15T11:00:00Z",
        frm=HENRIK, to=[LENA], cc=[],
        subject="Our referrals to Nordwind — can we talk about the commercials?",
        body="""Lena,

I have enjoyed working with your team and I would like to keep doing it, but I
have to raise something.

Since last September Blaubaum Consulting has referred seven opportunities to
Nordwind. Three of them closed, and I am told they are worth somewhere around
€290k a year to you. We have received nothing — not a fee, not a margin, not a
co-selling agreement. There is not even a partner agreement in place.

My partners ask me, reasonably, why we lead with Nordwind. Kestrel Supply IQ
approached us in April with a 20% first-year referral fee and a named partner
manager. I have declined so far because I think your product fits our
manufacturing clients better. I cannot keep declining indefinitely.

What I would like is simple: a written partner agreement with a 15% first-year
referral fee, and one person at Nordwind who owns the relationship.

Henrik Blaubaum
Partner, Blaubaum Consulting""",
    ),

    # --- 17. Internal read on the partner ask -------------------------------
    dict(
        id="nw-0017", thread="thr-partner", date="2026-06-17T13:40:00Z",
        frm=LENA, to=[BERND, RALF], cc=[],
        subject="Blaubaum want 15% — and I think we should say yes",
        body="""Bernd, Ralf,

Henrik Blaubaum has asked for a partner agreement: 15% first-year referral fee
and a named owner. Kestrel has offered him 20%.

The facts as far as I can reconstruct them:
- Seven referred opportunities since September. Three closed: about €290k ARR.
- Referred deals close in 61 days against our 94-day average, and I cannot find a
  single one where we discounted more than 10% — they arrive pre-sold.
- We have paid Blaubaum nothing and we have never had an agreement.
- Our own CAC on a self-sourced enterprise deal is roughly €31k. A 15% fee on a
  €78k ACV is €11.7k.

So the referral channel is our cheapest acquisition route and it is the only one
where nobody at Nordwind owns the relationship. We are getting it for free right
up to the moment we lose it, and Kestrel has already made the offer that takes
it away.

I would sign at 15%, with the first year only, and put Priya's name on it.

Lena""",
    ),

    # --- 18. Competitive loss: price + missing connector ---------------------
    dict(
        id="nw-0018", thread="thr-steinbeck", date="2026-06-23T15:15:00Z",
        frm=PRIYA, to=[LENA, MAREK], cc=[ANA],
        subject="Lost Steinbeck Automotive (€120k) to Kestrel — price and the SAP connector",
        body="""Lena, Marek,

Steinbeck is lost to Kestrel Supply IQ. Uwe Bartsch was straightforward about the
two reasons, and neither is a surprise.

1. Price. Kestrel came in at €96k against our €120k — 20% under. We could have
   matched it. I did not ask, because we had already discounted 15% and I did not
   want the conversation about a fourth exception.
2. The SAP connector. They run S/4HANA. Kestrel ships a certified connector.
   We asked them to build a middleware layer, which meant their IT team owning
   something new, and Bartsch said no.

The second reason is the one that matters. I have now lost or been blocked on
three deals this year where SAP came up: Steinbeck, Kranz (they run S/4HANA too)
and the Hansa Chemie opportunity that never got past the first call.

That is roughly €380k of pipeline sitting behind one integration.

Priya""",
    ),

    # --- 19. Product's roadmap trade-off ------------------------------------
    dict(
        id="nw-0019", thread="thr-roadmap", date="2026-06-25T10:10:00Z",
        frm=ANA, to=[LENA, BERND], cc=[TOMAS, PRIYA, MAREK],
        subject="H2 roadmap — I can fund the SAP connector or Nordic localization, not both",
        body="""Lena, Bernd,

Following Priya's Steinbeck note and Tomas's Nordfracht note, I have to be
explicit about the trade-off, because both of them are asking for the same two
engineers.

Option A — certified SAP S/4HANA connector. Estimate: one team, four months.
Unblocks Steinbeck-type deals. Priya counts about €380k of pipeline behind it.
Kestrel already has it, so this is a defensive move as much as an offensive one.

Option B — Norwegian and Danish localization of the operational screens (not the
whole product). Estimate: one team, ten weeks, plus roughly €40k of translation
and QA. Tomas has €640k of Nordics pipeline and two documented losses.

Doing both sequentially means the second one lands in Q1 2027.

What I need from you is not "both". It is a decision about which pipeline we are
willing to lose for two more quarters. My own view, for what it is worth: B is
cheaper, faster, and the losses are already documented; A is bigger but Kestrel
will still be ahead of us on it when we ship.

Ana""",
    ),

    # --- 20. The live competitive deal --------------------------------------
    dict(
        id="nw-0020", thread="thr-vestholm", date="2026-07-01T08:45:00Z",
        frm=TOMAS, to=[LENA], cc=[MAREK],
        subject="Vestholm Foods (€240k) — Kestrel are in it and they want a Danish reference",
        body="""Lena,

Vestholm Foods is our biggest open deal at €240k and I want to flag the risks
early rather than at the end of the quarter.

Where it stands: technical evaluation passed, Line Bruun is our champion, Anders
Holm (CFO) signs. Decision expected mid-September.

Three risks:
1. Kestrel are in the process. Line told me they have been asked to quote and
   she expects them to come in "significantly lower" — on past form, 15%.
2. They have asked, twice, for a Danish or Norwegian reference customer. I still
   do not have one. This is the same wall Nordfracht ended on.
3. Line has asked whether we can price per shipment rather than per user. Their
   seasonal staffing doubles in the autumn and they do not want to buy 60 seats
   for a ten-week peak.

Point 3 keeps coming up and I do not have an answer to give.

Tomas""",
    ),

    # --- 21. The pricing-model ask, from the customer -----------------------
    dict(
        id="nw-0021", thread="thr-vestholm", date="2026-07-07T12:30:00Z",
        frm=LINE, to=[TOMAS], cc=[ANDERS],
        subject="Commercial model — per shipment rather than per user",
        body="""Hi Tomas,

Thanks for the workshop last week — the team liked the forecast accuracy, and the
warehouse leads have stopped asking whether this replaces their spreadsheets,
which from them is enthusiasm.

On the commercial side, Anders has one condition and I agree with him. Per-user
pricing does not fit how we work. Our headcount in the autumn peak is roughly
double the rest of the year. Under your model we either buy 60 seats and leave 30
idle for nine months, or we share logins, which your contract does not allow and
which I do not want to do.

What we would sign today is a price per shipment processed, with a floor. Our
volume is fairly stable even when our headcount is not, so you would get a
predictable number and we would get a fair one.

Is that possible? If it is not, tell me, and we will work out whether we can live
with the seat model — but it will be the thing our CFO argues about.

Best,
Line Bruun
Supply Chain Director, Vestholm Foods A/S""",
    ),

    # --- 22. The pricing model is being gamed --------------------------------
    dict(
        id="nw-0022", thread="thr-pricing", date="2026-07-09T16:20:00Z",
        frm=RALF, to=[LENA, ANA], cc=[BERND],
        subject="Per-seat pricing is being gamed and it is costing us real money",
        body="""Lena, Ana,

Following Tomas's note about Vestholm, I asked our data team to look at login
patterns across the customer base. It confirms what I suspected.

- 9 of our 34 customers show more than three distinct devices per named seat in a
  typical week. That is shared logins.
- At Hafenlogistik the pattern is strongest: 38 named seats, but the traffic
  pattern looks like 60+ people.
- Meanwhile our own cost to serve tracks shipments processed, not seats. Our
  gross margin per customer varies between 61% and 88% for no commercial reason —
  it is just how far each customer's real usage has drifted from their seat count.

So we have a pricing model that our customers work around, that does not track
our cost, and that our largest prospect has now told us in writing is the reason
their CFO will argue.

I am not asking to rip up pricing mid-year. I am asking that we model a
per-shipment tier before the Vestholm decision in September, because right now we
are negotiating a €240k deal with a model we cannot defend.

Ralf""",
    ),

    # --- 23. Customer health report summary ---------------------------------
    dict(
        id="nw-0023", thread="thr-health", date="2026-07-15T09:00:00Z",
        frm=KATRIN, to=[BERND, LENA], cc=[RALF, ANA],
        subject="H1 customer health — NRR 96%, gross churn 11%, and where it comes from",
        body="""Bernd, Lena,

The H1 customer health report is attached to the shared drive; the summary:

- Net revenue retention: 96%. Gross churn: 11%. Expansion: 7%.
- Churned in H1: two accounts, €71k combined. Both SMB, both cited "we never got
  it fully working".
- At risk for H2: Alpenmetall (€95k, integration), Meyerhof Textil (€14k, support
  load, and honestly we should let this one go), and Bäcker Nord (€22k, sponsor
  left).
- Time to first value: 71 days median. For accounts where CS joined before
  signature it is 28 days. That is the single strongest predictor of renewal we
  have.
- Support load is inverted: our SMB customers generate 2.3x the tickets per euro
  of ARR that our enterprise customers do.

The pattern under all of it is the same one I raised with Alpenmetall. We sell,
we promise an implementation, and Customer Success finds out afterwards. Two of
nine accounts had CS involved before signature this year.

If we want NRR above 100% — and that is the cheapest growth available to us — the
fix is not a CS headcount. It is CS in the room before the signature.

Katrin""",
    ),

    # --- 24. CEO sets the objective -----------------------------------------
    dict(
        id="nw-0024", thread="thr-h2plan", date="2026-07-28T07:15:00Z",
        frm=BERND, to=[LENA, RALF, ANA, SOPHIE, KATRIN], cc=[PRIYA, TOMAS, JONAS, MAREK],
        subject="H2 planning — we are going for €9M ARR and I want the growth to be honest",
        body="""All,

Board met on Friday. The number for the end of 2027 is €9M ARR, from €6.2M today.
That is not a stretch we can discount our way into, so I want to be explicit about
how I think we get there and what I want each of you to bring on 12 August.

My reading of H1, from your own emails:

- We are not losing on product capability in demos. We are losing after the
  proposal: on price, on procurement friction, and in the Nordics on
  localization and references.
- We discount our way to 19.4% when the policy says 12%, which is roughly €412k
  of margin — that is growth we already earned and gave back.
- Our cheapest revenue is the revenue we already have. NRR is 96%. Hafenlogistik
  asked us for €180k and we have not sent the proposal.
- Our cheapest new revenue is Blaubaum's referrals, and we pay them nothing.
- 38% of the leads marketing buys are never worked in time.

So: the objective for H2 and 2027 is growing sales — new ARR, expansion ARR, and
the retention that makes both compound. When you bring me a plan, I want it in
that order, and I want the number attached to it.

Ana, the roadmap trade-off you raised is the one genuinely hard call in here and I
will make it on the 12th. Bring both estimates.

Bernd""",
    ),

    # --- 25. Q3 pipeline snapshot -------------------------------------------
    dict(
        id="nw-0025", thread="thr-h2plan", date="2026-08-03T18:05:00Z",
        frm=LENA, to=[BERND], cc=[RALF, SALESOPS],
        subject="Re: H2 planning — Q3 pipeline snapshot before the 12th",
        body="""Bernd,

Pipeline as it stands for the 12th.

Open Q3 pipeline: €4.1M across 47 opportunities. Coverage against the €1.9M Q3
target is 2.2x; I want 3.5x on a 22% win rate.

The five that decide the quarter:
- Vestholm Foods — €240k, decision mid-September, Kestrel in it, Danish reference
  still missing.
- Kranz Pharma — €140k, commercially approved since April, blocked on ISO 27001.
- Hafenlogistik expansion — €180k, customer-initiated, proposal still not sent.
- Rheinkontor Spedition — €95k, in legal.
- Two Nordics deals worth €210k combined that will both ask Tomas for a local
  reference.

Which means: of the €4.1M, roughly €560k is blocked on things that are not sales
work at all — a certificate, a translation and a reference customer. My AEs
cannot close any of them with better selling.

That is the honest version. I will bring the plan on the 12th.

Lena""",
    ),

    # --- 26. REDZONE: individual compensation (must be excluded) ------------
    dict(
        id="nw-0026", thread="thr-hr", date="2026-07-20T10:00:00Z",
        frm=BERND, to=[LENA], cc=[],
        subject="Confidential — Tomas Ek salary band and performance review",
        body="""Lena,

Strictly between us and HR, please do not forward.

Tomas has asked to be moved from band S3 to S4, which would take his base from
€82,000 to €94,500 plus a change to his variable split. His last performance
review flagged two concerns about pipeline hygiene, and HR have noted a pending
grievance from a colleague in the Stockholm office that is still being handled.

I would rather not decide this until the grievance process is closed. Please keep
this out of any team discussion.

Bernd""",
    ),

    # --- 27. SPAM: conference marketing (must be excluded) ------------------
    dict(
        id="nw-0027", thread="thr-spam", date="2026-06-30T05:30:00Z",
        frm="SaaS Growth Europa <no-reply@saasgrowth-europa.example>", to=[LENA], cc=[],
        subject="Last chance: 40% off early-bird tickets to SaaS Growth Europa 2026",
        body="""Hi there,

Early-bird pricing for SaaS Growth Europa 2026 ends at midnight! Join 4,000
revenue leaders in Barcelona for three days of keynotes, workshops and networking.

Use code GROWTH40 for 40% off. Limited seats remaining — book now!

Sponsored by our platinum partners. You are receiving this email because you
downloaded a whitepaper from one of our partners.

Unsubscribe | Manage preferences | Privacy policy""",
    ),
]
