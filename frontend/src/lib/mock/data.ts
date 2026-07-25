import type {
  ActivityItem,
  Company,
  DailyCheckIn,
  Deliverable,
  KnowledgeGraph,
  Person,
  Project,
  Task,
  Workstream,
} from "./types";

// ---------- Dates: always relative to "now" ----------
// The demo's narrative was authored around a fixed anchor date. We compute the
// delta between that anchor and *today*, then shift every authored absolute
// date by it — so the whole demo always sits around the current day:
//   - the morning check-in is for today
//   - the Gantt's "today" line lands mid-engagement
//   - deliverables that were "done" stay in the past, "upcoming" stay ahead
//   - the project window straddles the current date
//
// DEMO_NOW is evaluated whenever the module loads (build time on the server,
// view time in the browser). Since the deployed app is fully client-side, in
// production DEMO_NOW is always the viewer's current time.
export const DEMO_NOW = new Date();

const NARRATIVE_ANCHOR = new Date("2026-05-26T12:00:00Z");
const SHIFT_MS = DEMO_NOW.getTime() - NARRATIVE_ANCHOR.getTime();

/** ISO timestamp `days`/`hours` before now (relative offsets). */
const isoMinus = (days: number, hours = 0) => {
  const d = new Date(DEMO_NOW);
  d.setDate(d.getDate() - days);
  d.setHours(d.getHours() - hours);
  return d.toISOString();
};

/** An authored absolute date (in the narrative's 2026 calendar), shifted so
 *  it sits the same distance from "today" as it did from the anchor. Noon UTC
 *  keeps the calendar day stable across viewer timezones. */
const isoDate = (year: number, month: number, day: number) =>
  new Date(
    new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getTime() + SHIFT_MS
  ).toISOString();

// ---------- People ----------
// Consultancy: "Meridian Strategy Partners" — boutique strategy firm
// Demo PM is "you" — Maya Chen.

const meridianTeam: Person[] = [
  {
    id: "p_maya",
    name: "Maya Chen",
    role: "Engagement Manager",
    email: "maya.chen@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    synced: true,
    joinedAt: "2026-03-02",
  },
  {
    id: "p_jonas",
    name: "Jonas Weber",
    role: "Senior Associate — Market Sizing",
    email: "jonas.weber@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    synced: true,
    joinedAt: "2026-03-02",
  },
  {
    id: "p_priya",
    name: "Priya Raman",
    role: "Senior Associate — Competitive Landscape",
    email: "priya.raman@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    synced: true,
    joinedAt: "2026-03-02",
  },
  {
    id: "p_diego",
    name: "Diego Alvarez",
    role: "Associate — Regulatory",
    email: "diego.alvarez@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    synced: true,
    joinedAt: "2026-03-09",
  },
  {
    id: "p_sofia",
    name: "Sofia Lindqvist",
    role: "Associate — GTM & Partnerships",
    email: "sofia.lindqvist@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    synced: true,
    joinedAt: "2026-03-02",
  },
];

const meridianPartners: Person[] = [
  {
    id: "p_alex",
    name: "Alexandra Foster",
    role: "Partner",
    email: "alex.foster@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    isPartner: true,
  },
  {
    id: "p_thomas",
    name: "Thomas Reinhardt",
    role: "Partner",
    email: "thomas.reinhardt@meridianstrategy.com",
    company: "Meridian Strategy Partners",
    isPartner: true,
  },
];

const latticeContacts: Person[] = [
  {
    id: "p_ravi",
    name: "Ravi Subramanian",
    role: "VP International — Lattice Pay",
    email: "ravi@latticepay.com",
    company: "Lattice Pay",
    isClient: true,
  },
  {
    id: "p_emma",
    name: "Emma Hollis",
    role: "Head of Strategy — Lattice Pay",
    email: "emma.hollis@latticepay.com",
    company: "Lattice Pay",
    isClient: true,
  },
  {
    id: "p_kenji",
    name: "Kenji Yamada",
    role: "CFO — Lattice Pay",
    email: "kenji@latticepay.com",
    company: "Lattice Pay",
    isClient: true,
  },
];

// ---------- Companies ----------
const latticePay: Company = {
  id: "co_lattice",
  name: "Lattice Pay",
  description:
    "US-based B2B payments platform processing ~$14B in cross-border volume. Series C, last raised $80M at $620M post in late 2025.",
  industry: "B2B Fintech / Payments",
};

// ---------- Workstreams ----------
const workstreams: Workstream[] = [
  {
    id: "ws_market",
    name: "Market Sizing & TAM",
    description:
      "Build defensible TAM/SAM for B2B cross-border payments in EU-27 + UK by segment (SMB, mid-market, enterprise). Validate against 3rd party datasets.",
    owner: "p_jonas",
    status: "on-track",
    progress: 78,
    nextMilestone: "EU mid-market deep-dive — sized by country",
    dueDate: isoDate(2026, 5, 29),
  },
  {
    id: "ws_competitive",
    name: "Competitive Landscape",
    description:
      "Map incumbents (Adyen, Stripe, Banking Circle) and challengers. Quantify share, pricing, fee structures, product gaps Lattice can exploit.",
    owner: "p_priya",
    status: "on-track",
    progress: 65,
    nextMilestone: "Pricing teardown — Adyen vs Stripe SMB",
    dueDate: isoDate(2026, 6, 2),
  },
  {
    id: "ws_regulatory",
    name: "Regulatory (PSD2, MiCA, EBA)",
    description:
      "Map license requirements per entry market. Decide between MiCA passport via Ireland vs Lithuania E-Money license vs partner-bank model.",
    owner: "p_diego",
    status: "at-risk",
    progress: 42,
    nextMilestone: "EBA guidance memo — partner-bank structure",
    dueDate: isoDate(2026, 6, 5),
  },
  {
    id: "ws_gtm",
    name: "GTM & Partnerships",
    description:
      "Define 3-market launch sequence, hiring plan, partner channel (ERP integrators, accounting platforms). Synthesize into 12/24-month plan.",
    owner: "p_sofia",
    status: "on-track",
    progress: 51,
    nextMilestone: "Channel partner shortlist — SAP, Sage, DATEV",
    dueDate: isoDate(2026, 6, 8),
  },
];

// ---------- Activity ----------
// Activity feed dates are relative offsets from "now", so the feed always
// reads as recent regardless of when the demo is viewed.
const recentActivity: ActivityItem[] = [
  {
    id: "act_1",
    type: "decision",
    title: "Lithuania over Ireland for E-Money license",
    summary:
      "Diego synthesized EBA guidance + a call with Walkers (Dublin). Lithuania's 3-month timeline beats Ireland's 9-month by enough to be worth the smaller passporting footprint. Ravi (Lattice) confirmed alignment.",
    source: "Email: 'Re: License path — recommendation' from Diego",
    workstreamId: "ws_regulatory",
    participants: ["p_diego", "p_ravi", "p_maya"],
    date: isoMinus(1, 1),
  },
  {
    id: "act_2",
    type: "deliverable",
    title: "Adyen pricing teardown — v2 draft",
    summary:
      "Priya delivered second draft. New finding: Adyen's interchange-plus pricing has a 12bps margin window in the €1–10M segment that incumbents quietly subsidize. Recommendation: Lattice undercuts by 4bps in Y1.",
    source: "Email: 'Adyen teardown — v2 attached' from Priya",
    workstreamId: "ws_competitive",
    participants: ["p_priya", "p_maya", "p_jonas"],
    date: isoMinus(2),
  },
  {
    id: "act_3",
    type: "risk",
    title: "MiCA reclassification risk for stablecoin rails",
    summary:
      "EBA published a Q2 supervisory note. Lattice's stablecoin settlement rail may fall under ART rules in 2027, requiring a Significant Issuer designation. Material impact on the 24-month plan if Lattice proceeds.",
    source: "Email: 'EBA note — heads up' from Diego",
    workstreamId: "ws_regulatory",
    participants: ["p_diego", "p_maya"],
    date: isoMinus(2, 3),
  },
  {
    id: "act_4",
    type: "milestone",
    title: "Germany TAM validated — €38B SAM by 2028",
    summary:
      "Jonas cross-checked the McKinsey 2024 baseline against Bundesbank quarterly cross-border flows. Final SAM for German mid-market: €38B by 2028, +/- 8%. Validated by Emma (Lattice).",
    source: "Email: 'Germany numbers — locked' from Jonas",
    workstreamId: "ws_market",
    participants: ["p_jonas", "p_emma", "p_maya"],
    date: isoMinus(4),
  },
  {
    id: "act_5",
    type: "decision",
    title: "Launch sequence: Germany → Netherlands → France",
    summary:
      "Sofia proposed reordering. Germany first (biggest SAM, B2B-native), Netherlands second (regulatory passport test), France third (most fragmented channel landscape — wait for ERP partner traction). Ravi approved.",
    source: "Email: 'GTM seq — proposal' from Sofia",
    workstreamId: "ws_gtm",
    participants: ["p_sofia", "p_ravi", "p_maya"],
    date: isoMinus(5),
  },
  {
    id: "act_6",
    type: "deliverable",
    title: "Channel partner long-list — 47 firms",
    summary:
      "Sofia's first cut: 47 firms across SAP/Oracle ecosystems, regional accounting platforms (DATEV, Sage), and embedded-finance enablers. Top 12 flagged for outreach in week 11.",
    source: "Document: 'Channel_LongList_v1.xlsx' (SharePoint)",
    workstreamId: "ws_gtm",
    participants: ["p_sofia"],
    date: isoMinus(6),
  },
  {
    id: "act_7",
    type: "email",
    title: "Kenji asked for 3-yr P&L per market",
    summary:
      "CFO wants a country-level P&L (revenue / direct cost / contribution) for the top 3 markets. Maya assigned to Jonas + Sofia jointly, due end of next week.",
    source: "Email: 'Country P&L request' from Kenji (CFO, Lattice)",
    participants: ["p_kenji", "p_maya", "p_jonas", "p_sofia"],
    date: isoMinus(6, 4),
  },
  {
    id: "act_8",
    type: "decision",
    title: "Don't pursue UK in Y1",
    summary:
      "Post-Brexit dual-license cost + slower decision cycles → UK pushed to Y2. Confirmed with Emma + Ravi on the weekly check-in.",
    source: "Email: 'UK decision — confirmed' from Emma (Lattice)",
    workstreamId: "ws_gtm",
    participants: ["p_emma", "p_ravi", "p_maya"],
    date: isoMinus(7, 6),
  },
  {
    id: "act_9",
    type: "deliverable",
    title: "Competitive matrix v1 — 14 players",
    summary:
      "Priya's first competitive matrix covering 14 players across 6 dimensions (pricing, license footprint, B2B share, integration depth, settlement speed, FX margin).",
    source: "Document: 'Competitive_Matrix_v1.pdf' (SharePoint)",
    workstreamId: "ws_competitive",
    participants: ["p_priya"],
    date: isoMinus(10),
  },
  {
    id: "act_10",
    type: "milestone",
    title: "Kickoff & week-1 plan locked",
    summary:
      "First week of engagement closed. Workstream owners assigned, weekly cadence with Ravi established (Tuesdays 10am ET), partner check-in every other Friday.",
    source: "Email: 'Week 1 wrap' from Maya",
    participants: ["p_maya", "p_ravi", "p_alex"],
    date: isoMinus(28),
  },
];

// ---------- Deliverables ----------
// Formal outputs of each workstream. Each has an editable scope description
// that the manager curates. Status tracks the lifecycle from todo → done.
// Due dates use isoDate() so they shift to stay relative to today.

const deliverables: Deliverable[] = [
  // Market Sizing
  {
    id: "d_germany_sam",
    title: "Germany SAM model",
    description:
      "Bottom-up sizing of the German B2B cross-border payments SAM by 2028, segmented by company-size band (SMB / mid-market / enterprise). Methodology: McKinsey 2024 baseline reconciled against Bundesbank quarterly cross-border flows. Validated with Lattice (Emma).",
    workstreamId: "ws_market",
    ownerId: "p_jonas",
    status: "done",
    dueDate: isoDate(2026, 5, 15),
    createdAt: isoMinus(35),
  },
  {
    id: "d_france_sam",
    title: "France SAM model",
    description:
      "Bottom-up sizing of the French B2B cross-border payments SAM by 2028, same methodology as Germany. Banque de France flow data + Eurostat firmographics. Top-down validation against Capgemini's 2024 payments report.",
    workstreamId: "ws_market",
    ownerId: "p_jonas",
    status: "in-progress",
    dueDate: isoDate(2026, 5, 29),
    createdAt: isoMinus(20),
  },
  {
    id: "d_netherlands_sam",
    title: "Netherlands SAM model",
    description:
      "Bottom-up sizing of the Dutch B2B cross-border payments SAM by 2028. Methodology mirrors Germany. DNB flow data + CBS firmographics. Smaller market — primarily a regulatory-passport test bed, not a TAM bet on its own.",
    workstreamId: "ws_market",
    ownerId: "p_jonas",
    status: "todo",
    dueDate: isoDate(2026, 6, 2),
    createdAt: isoMinus(15),
  },
  {
    id: "d_market_synth",
    title: "Final market sizing synthesis deck",
    description:
      "Board-ready synthesis: EU-wide TAM by segment, top-3 launch markets with defensible SAM, sensitivity analysis on key drivers (cross-border flow growth, B2B share, fee compression). 10-12 slides max.",
    workstreamId: "ws_market",
    ownerId: "p_jonas",
    status: "in-review",
    dueDate: isoDate(2026, 6, 8),
    createdAt: isoMinus(10),
  },

  // Competitive
  {
    id: "d_comp_matrix",
    title: "Competitive matrix v1",
    description:
      "14 players across 6 dimensions: pricing model + bps margin range, license footprint (countries + entity types), B2B revenue share, integration depth (top 5 ERPs/accounting), settlement speed (T+0/1/2), FX margin (interbank vs retail).",
    workstreamId: "ws_competitive",
    ownerId: "p_priya",
    status: "done",
    dueDate: isoDate(2026, 5, 18),
    createdAt: isoMinus(28),
  },
  {
    id: "d_adyen_teardown",
    title: "Adyen pricing teardown v2",
    description:
      "Reverse-engineered fee structure across SMB / mid-market / enterprise tiers. Key finding: a 12 bps margin window in the €1–10M segment that Adyen and incumbents subsidize. Includes our recommendation to undercut by 4 bps in Year 1.",
    workstreamId: "ws_competitive",
    ownerId: "p_priya",
    status: "done",
    dueDate: isoDate(2026, 5, 24),
    createdAt: isoMinus(15),
  },
  {
    id: "d_stripe_teardown",
    title: "Stripe SMB pricing teardown",
    description:
      "Reverse-engineer Stripe's effective B2B SMB pricing in the EU, including the Stripe Treasury bundle. Compare to Adyen findings to triangulate the SMB margin floor. Output: 1-pager + supporting model.",
    workstreamId: "ws_competitive",
    ownerId: "p_priya",
    status: "in-progress",
    dueDate: isoDate(2026, 6, 2),
    createdAt: isoMinus(7),
  },
  {
    id: "d_banking_circle",
    title: "Banking Circle deep-dive",
    description:
      "Profile Banking Circle's B2B cross-border product, license footprint, banking partnerships, and pricing. Specifically: is their settlement infrastructure a competitive moat or a commodity?",
    workstreamId: "ws_competitive",
    ownerId: "p_priya",
    status: "todo",
    dueDate: isoDate(2026, 6, 5),
    createdAt: isoMinus(3),
  },

  // Regulatory
  {
    id: "d_license_memo",
    title: "License path memo — Lithuania recommendation",
    description:
      "Recommendation document for Lattice executive team: pursue Lithuanian E-Money license + Belgian SEPA passport. Compares against Ireland EMI (slower) and partner-bank-only path (capped optionality). Includes timeline, cost, and exit-state map.",
    workstreamId: "ws_regulatory",
    ownerId: "p_diego",
    status: "done",
    dueDate: isoDate(2026, 5, 26),
    createdAt: isoMinus(18),
  },
  {
    id: "d_mica_memo",
    title: "MiCA stablecoin risk memo",
    description:
      "Risk memo on EBA's Q2 supervisory note signaling likely MiCA reclassification of Lattice's stablecoin settlement rail as ART in 2027, triggering Significant Issuer designation. Outlines the capital + governance implications and three response options: descope, redesign, or push the timeline.",
    workstreamId: "ws_regulatory",
    ownerId: "p_diego",
    status: "in-progress",
    dueDate: isoDate(2026, 5, 30),
    createdAt: isoMinus(3),
    atRisk: true,
  },
  {
    id: "d_partner_bank",
    title: "EBA partner-bank structure memo",
    description:
      "Fallback memo: if Lithuanian timeline slips past 4 months, what's the bridge? Compare Solaris vs Treezor as partner-bank options for SEPA + cards. Includes term-sheet expectations, integration timeline, and exit migration path.",
    workstreamId: "ws_regulatory",
    ownerId: "p_diego",
    status: "todo",
    dueDate: isoDate(2026, 6, 5),
    createdAt: isoMinus(5),
    atRisk: true,
  },
  {
    id: "d_reg_chapter",
    title: "Final regulatory chapter",
    description:
      "Synthesis of all regulatory decisions: license path, MiCA position, partner-bank fallback, jurisdiction sequence. 8-10 slides into the board deck.",
    workstreamId: "ws_regulatory",
    ownerId: "p_diego",
    status: "todo",
    dueDate: isoDate(2026, 6, 10),
    createdAt: isoMinus(8),
    atRisk: true,
  },

  // GTM
  {
    id: "d_launch_seq",
    title: "Launch sequence memo",
    description:
      "Recommended market sequence: Germany (Y1 H2) → Netherlands (Y1 H2, regulatory test) → France (Y2 H1, after partner traction). UK pushed to Y2 due to post-Brexit dual-license cost.",
    workstreamId: "ws_gtm",
    ownerId: "p_sofia",
    status: "done",
    dueDate: isoDate(2026, 5, 22),
    createdAt: isoMinus(14),
  },
  {
    id: "d_partner_longlist",
    title: "Channel partner long-list (47 firms)",
    description:
      "47-firm long-list across SAP/Oracle ecosystem, regional accounting platforms (DATEV, Sage, Exact), and embedded-finance enablers. Includes scoring across 5 axes: market access, integration cost, partner-economics, brand fit, regulatory fit.",
    workstreamId: "ws_gtm",
    ownerId: "p_sofia",
    status: "done",
    dueDate: isoDate(2026, 5, 23),
    createdAt: isoMinus(13),
  },
  {
    id: "d_partner_shortlist",
    title: "Channel partner shortlist — top 5",
    description:
      "Narrow the long-list to the 5 channel partners we recommend for week-11 outreach. Should over-index on Germany given the launch sequence: DATEV, SAP, plus 1-2 embedded-finance enablers with strong DACH presence.",
    workstreamId: "ws_gtm",
    ownerId: "p_sofia",
    status: "in-progress",
    dueDate: isoDate(2026, 6, 8),
    createdAt: isoMinus(6),
  },
  {
    id: "d_gtm_plan",
    title: "24-month GTM plan",
    description:
      "End-to-end 24-month plan: hiring (per-market headcount + ramp), partner activation timeline, marketing investment by stage, customer-acquisition assumptions. Bridges to the country-level P&Ls Kenji asked for.",
    workstreamId: "ws_gtm",
    ownerId: "p_sofia",
    status: "in-progress",
    dueDate: isoDate(2026, 6, 10),
    createdAt: isoMinus(9),
  },
];

// ---------- Tasks ----------
// Small todos. Most are "proposed" — they came from this morning's check-in
// proposal that the manager hasn't yet sent. A few are "in-progress" carry-
// overs to show the data isn't homogeneous.

const tasks: Task[] = [
  // Maya
  {
    id: "t_maya_1",
    title: "Review Diego's MiCA risk memo draft",
    description:
      "Read v1 by 1pm so Diego has time to incorporate edits before tomorrow's board prep.",
    assigneeId: "p_maya",
    workstreamId: "ws_regulatory",
    deliverableId: "d_mica_memo",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8), // end of today
    proposedBy: "iota",
  },
  {
    id: "t_maya_2",
    title: "Sync with Alex (partner) before Friday checkpoint",
    description:
      "MiCA risk needs a partner POV before we present descope option to Lattice. 30 min slot today.",
    assigneeId: "p_maya",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_maya_3",
    title: "Kick off country P&L synthesis",
    description:
      "Spin up the shared model that Jonas + Sofia will populate. Lock the tab structure before they start so we don't end up reconciling.",
    assigneeId: "p_maya",
    workstreamId: "ws_market",
    status: "proposed",
    priority: "medium",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },

  // Jonas
  {
    id: "t_jonas_1",
    title: "Finish France SAM model",
    description:
      "Two open cells: SMB cross-border share + FX-conversion assumption. Once locked, push to shared folder.",
    assigneeId: "p_jonas",
    workstreamId: "ws_market",
    deliverableId: "d_france_sam",
    status: "in-progress",
    priority: "high",
    createdAt: isoMinus(1),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_jonas_2",
    title: "Germany P&L — revenue build (Kenji's request)",
    description:
      "Top-line by segment using the locked Germany SAM. Sofia owns the cost side. Aim for a v1 by EOD.",
    assigneeId: "p_jonas",
    workstreamId: "ws_market",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_jonas_3",
    title: "Send Bundesbank cross-refs to Emma",
    description:
      "Emma asked last Friday — quick win, follow up so she's not chasing.",
    assigneeId: "p_jonas",
    workstreamId: "ws_market",
    status: "proposed",
    priority: "medium",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-1, -8),
    proposedBy: "iota",
  },

  // Priya
  {
    id: "t_priya_1",
    title: "Stripe SMB teardown — first draft outline",
    description:
      "Mirror the Adyen v2 structure. Don't go deep yet — just the section skeleton and the data we need to gather.",
    assigneeId: "p_priya",
    workstreamId: "ws_competitive",
    deliverableId: "d_stripe_teardown",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_priya_2",
    title: "Update competitive matrix v2 with Adyen findings",
    description:
      "The 12 bps margin window finding belongs in the matrix as a quantified gap.",
    assigneeId: "p_priya",
    workstreamId: "ws_competitive",
    status: "proposed",
    priority: "medium",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-1, -8),
    proposedBy: "iota",
  },
  {
    id: "t_priya_3",
    title: "Banking Circle research call setup",
    description:
      "Find a former Banking Circle PM via LinkedIn. Aim for a 30-min call this week.",
    assigneeId: "p_priya",
    workstreamId: "ws_competitive",
    deliverableId: "d_banking_circle",
    status: "proposed",
    priority: "low",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-3, -8),
    proposedBy: "iota",
  },

  // Diego
  {
    id: "t_diego_1",
    title: "MiCA risk memo — first complete draft",
    description:
      "Three options framing: descope stablecoin rail / redesign settlement / push timeline. Each with capital impact and team posture.",
    assigneeId: "p_diego",
    workstreamId: "ws_regulatory",
    deliverableId: "d_mica_memo",
    status: "in-progress",
    priority: "high",
    createdAt: isoMinus(1),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_diego_2",
    title: "Prep Solaris partner-bank call (Wed 11am)",
    description:
      "Three questions to get answered: capital requirements they pass through, SEPA-DD coverage, exit clause.",
    assigneeId: "p_diego",
    workstreamId: "ws_regulatory",
    deliverableId: "d_partner_bank",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-1, -8),
    proposedBy: "iota",
  },
  {
    id: "t_diego_3",
    title: "EBA guidance memo — bullet outline",
    description:
      "Don't write the memo yet, just the spine. Five bullets max, structured for Maya's review.",
    assigneeId: "p_diego",
    workstreamId: "ws_regulatory",
    deliverableId: "d_partner_bank",
    status: "proposed",
    priority: "medium",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-3, -8),
    proposedBy: "iota",
  },

  // Sofia
  {
    id: "t_sofia_1",
    title: "Narrow channel partner shortlist to top 5",
    description:
      "From the 12 flagged, pick the 5 we'd actually approach week-11. DACH-weighted given launch sequence.",
    assigneeId: "p_sofia",
    workstreamId: "ws_gtm",
    deliverableId: "d_partner_shortlist",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_sofia_2",
    title: "Germany P&L — cost build (Kenji's request)",
    description:
      "Sales hiring, partner enablement, marketing investment by stage. Jonas owns the revenue side — sync at noon.",
    assigneeId: "p_sofia",
    workstreamId: "ws_gtm",
    status: "proposed",
    priority: "high",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-0, -8),
    proposedBy: "iota",
  },
  {
    id: "t_sofia_3",
    title: "Reach out to DATEV partnerships team",
    description:
      "Warm intro available via the Helios engagement. Use it. Goal: a 20-min intro call.",
    assigneeId: "p_sofia",
    workstreamId: "ws_gtm",
    status: "proposed",
    priority: "medium",
    createdAt: isoMinus(0, 2),
    dueAt: isoMinus(-3, -8),
    proposedBy: "iota",
  },
];

// ---------- Today's Morning Check-in ----------
// What Iota proposes for this morning. Yesterday recap + per-person task lists
// that the manager (Maya) can edit before sending.

const todaysCheckIn: DailyCheckIn = {
  id: "checkin_2026_05_26",
  date: DEMO_NOW.toISOString(),
  yesterdaySummary: `Three big things happened yesterday on Lattice Pay. **Diego closed the license-path call with Walkers Dublin** and the recommendation is now in front of Ravi — Lithuania E-Money license, Belgian SEPA passport. **EBA published a Q2 supervisory note** that could push Lattice's stablecoin rail into Significant Issuer territory in 2027 — Diego flagged it as a material risk. And **Kenji (CFO) asked for 3-year country-level P&Ls** for the top 3 markets, which lands jointly on Jonas + Sofia and needs Maya's synthesis.`,
  yesterdayHighlights: [
    {
      label: "Lithuania over Ireland — license path confirmed",
      detail: "Walkers Dublin call closed. Ravi aligned.",
      type: "decision",
    },
    {
      label: "MiCA reclassification risk surfaced",
      detail: "EBA Q2 note. Material if stablecoin rail stays in scope.",
      type: "risk",
    },
    {
      label: "Kenji requested 3-yr country P&Ls",
      detail: "Top 3 markets. Jonas + Sofia, jointly. Due end of next week.",
      type: "request",
    },
    {
      label: "Adyen pricing teardown v2 delivered",
      detail: "12 bps margin window finding. Locked.",
      type: "deliverable",
    },
  ],
  proposals: [
    {
      personId: "p_maya",
      rationale:
        "MiCA memo lands today and needs your read. Partner sync should happen before Friday so Alex doesn't see the descope option for the first time in the meeting.",
      proposedTaskIds: ["t_maya_1", "t_maya_2", "t_maya_3"],
    },
    {
      personId: "p_jonas",
      rationale:
        "France SAM is two cells from done — push it across today. Kenji's revenue build needs a v1 so Sofia's cost work doesn't stall.",
      proposedTaskIds: ["t_jonas_1", "t_jonas_2", "t_jonas_3"],
    },
    {
      personId: "p_priya",
      rationale:
        "Stripe teardown started yesterday — keep momentum. Adyen findings should flow into v2 of the matrix before they go stale.",
      proposedTaskIds: ["t_priya_1", "t_priya_2", "t_priya_3"],
    },
    {
      personId: "p_diego",
      rationale:
        "MiCA memo is the critical path for the board deck — get the three-option framing on the page today. Solaris call prep is quick but high-leverage.",
      proposedTaskIds: ["t_diego_1", "t_diego_2", "t_diego_3"],
    },
    {
      personId: "p_sofia",
      rationale:
        "Channel shortlist is the gate for week-11 outreach. P&L cost build needs to start moving today so Jonas isn't blocked.",
      proposedTaskIds: ["t_sofia_1", "t_sofia_2", "t_sofia_3"],
    },
  ],
  status: "draft",
};

// ---------- Knowledge Graph ----------
// Build a graph from any Project. For new projects with empty arrays
// (activity/deliverables/tasks/clientContacts), the graph stays sparse but
// coherent: company + consultancy + project + workstreams + team.
//
// The hardcoded consultancy id ("co_meridian") is fine because this is a
// single-firm demo — Meridian Strategy Partners is "us".
export const buildKnowledgeGraph = (project: Project): KnowledgeGraph => {
  const nodes: KnowledgeGraph["nodes"] = [];
  const links: KnowledgeGraph["links"] = [];

  const clientCoId = project.clientCompany.id;
  const projectNodeId = `proj_${project.id}`;

  // Client company
  nodes.push({
    id: clientCoId,
    label: project.clientCompany.name,
    type: "company",
    group: "client",
    description:
      project.clientCompany.description ||
      `Client — ${project.clientCompany.industry}`,
    val: 18,
  });

  // Consultancy (us)
  nodes.push({
    id: "co_meridian",
    label: "Meridian Strategy",
    type: "company",
    group: "consultancy",
    description: "Our firm",
    val: 14,
  });

  // Project node
  nodes.push({
    id: projectNodeId,
    label: project.name,
    type: "objective",
    group: "project",
    description: project.description,
    val: 16,
  });
  links.push({ source: projectNodeId, target: clientCoId, type: "client", label: "for" });
  links.push({ source: "co_meridian", target: projectNodeId, type: "works-on", label: "delivers" });

  // Workstreams
  project.workstreams.forEach((ws) => {
    nodes.push({
      id: ws.id,
      label: ws.name,
      type: "workstream",
      group: "workstream",
      description: ws.description,
      val: 11,
    });
    links.push({ source: projectNodeId, target: ws.id, type: "involves" });
  });

  // Team + partners (firm-side people)
  [...project.team, ...project.partners].forEach((person) => {
    nodes.push({
      id: person.id,
      label: person.name,
      type: "person",
      group: person.isPartner ? "partner" : "consultant",
      description: person.role,
      val: person.isPartner ? 9 : 7,
    });
    links.push({
      source: person.id,
      target: "co_meridian",
      type: "works-on",
    });
  });

  // Workstream-ownership edges
  project.workstreams.forEach((ws) => {
    links.push({ source: ws.owner, target: ws.id, type: "owns", label: "owns" });
  });

  // Client contacts (could be empty for day-0 projects)
  project.clientContacts.forEach((person) => {
    nodes.push({
      id: person.id,
      label: person.name,
      type: "person",
      group: "client",
      description: person.role,
      val: 7,
    });
    links.push({ source: person.id, target: clientCoId, type: "works-on" });
  });

  // Formal deliverables — linked to their workstream + owner
  project.deliverables.forEach((d) => {
    nodes.push({
      id: d.id,
      label: d.title,
      type: "deliverable",
      group: "deliverable",
      description: d.description,
      val: 5,
    });
    links.push({ source: d.workstreamId, target: d.id, type: "produces" });
    links.push({ source: d.ownerId, target: d.id, type: "delivers" });
  });

  // Tasks — assignee always, workstream/deliverable optional
  project.tasks.forEach((t) => {
    nodes.push({
      id: t.id,
      label: t.title,
      type: "task",
      group: "task",
      description: t.description,
      val: 3,
    });
    links.push({ source: t.assigneeId, target: t.id, type: "assigned-to" });
    if (t.workstreamId) {
      links.push({ source: t.workstreamId, target: t.id, type: "involves" });
    }
    if (t.deliverableId) {
      links.push({ source: t.id, target: t.deliverableId, type: "depends-on" });
    }
  });

  // Decisions / risks / milestones — derived from activity feed
  const seen = new Set<string>();
  project.recentActivity.forEach((act) => {
    if (act.type === "email" || act.type === "deliverable") return;
    const id = `act_${act.id}`;
    if (seen.has(id)) return;
    seen.add(id);

    const nodeType =
      act.type === "decision"
        ? "decision"
        : act.type === "risk"
        ? "risk"
        : "milestone";
    nodes.push({
      id,
      label: act.title,
      type: nodeType,
      group: nodeType,
      description: act.summary,
      val: 5,
    });
    if (act.workstreamId) {
      links.push({ source: act.workstreamId, target: id, type: "produces" });
    } else {
      links.push({ source: projectNodeId, target: id, type: "produces" });
    }
    act.participants.forEach((pId) => {
      links.push({ source: pId, target: id, type: "involves" });
    });
  });

  return { nodes, links };
};

// ---------- The main demo project ----------
const latticePayProjectBase = {
  name: "EU Market Entry Strategy",
  client: "Lattice Pay",
  status: "active" as const,
  description:
    "12-week strategy engagement to define Lattice Pay's European market entry: target markets, regulatory path, competitive positioning, and 24-month GTM plan.",
  context:
    "Lattice closed Series C in late 2025 with explicit board direction to enter EU before US TAM saturation in 2027. Ravi (VP International) is the day-to-day client lead; Kenji (CFO) is the budget owner. The board reviews progress in Q3.",
  startDate: isoDate(2026, 3, 2),
  endDate: isoDate(2026, 5, 25),
  weekNumber: 12,
  totalWeeks: 12,
  workstreams,
  team: meridianTeam,
  partners: meridianPartners,
  clientContacts: latticeContacts,
  recentActivity,
  deliverables,
  tasks,
  todaysCheckIn,
  emailsScanned: 487,
  filesScanned: 142,
  slackMessagesScanned: 1284,
  brainPages: 64,
  slackChannels: [
    "#lattice-pay-eu",
    "#lattice-regulatory",
    "#lattice-pay-internal",
  ],
  sharepointPath:
    "meridian.sharepoint.com/sites/lattice-eu",
  lastSync: isoMinus(0, 0),
};

export const latticePayProject: Project = {
  id: "proj_lattice_eu",
  clientCompany: latticePay,
  ...latticePayProjectBase,
};

export const latticePayGraph = buildKnowledgeGraph(latticePayProject);

// ---------- Other (shallow) projects for the dashboard list ----------
export const otherProjects: Project[] = [
  {
    id: "proj_atlas_supply",
    name: "Supply Chain Resilience Diagnostic",
    client: "Atlas Manufacturing",
    clientCompany: {
      id: "co_atlas",
      name: "Atlas Manufacturing",
      description: "Mid-market industrial manufacturer",
      industry: "Manufacturing",
    },
    status: "active",
    description:
      "6-week diagnostic on supplier concentration risk across Tier 1 and Tier 2 suppliers, with mitigation roadmap.",
    context: "Board requested diagnostic after Q1 disruption event.",
    startDate: isoDate(2026, 4, 20),
    endDate: isoDate(2026, 6, 1),
    weekNumber: 5,
    totalWeeks: 6,
    workstreams: [],
    team: [],
    partners: [],
    clientContacts: [],
    recentActivity: [],
    deliverables: [],
    tasks: [],
    emailsScanned: 142,
    filesScanned: 89,
    slackMessagesScanned: 412,
    brainPages: 23,
    slackChannels: ["#atlas-supply"],
    sharepointPath: "meridian.sharepoint.com/sites/atlas-diag",
    lastSync: isoMinus(0, 2),
  },
  {
    id: "proj_helios_pe",
    name: "Helios — PE Due Diligence",
    client: "Polaris Capital",
    clientCompany: {
      id: "co_polaris",
      name: "Polaris Capital",
      description: "PE fund focused on industrial tech",
      industry: "Private Equity",
    },
    status: "closing",
    description:
      "Commercial DD on a renewable-energy software target. Market, competitors, customer references, and key risk synthesis.",
    context: "Tight 4-week timeline. Final read-out next Tuesday.",
    startDate: isoDate(2026, 4, 29),
    endDate: isoDate(2026, 5, 27),
    weekNumber: 4,
    totalWeeks: 4,
    workstreams: [],
    team: [],
    partners: [],
    clientContacts: [],
    recentActivity: [],
    deliverables: [],
    tasks: [],
    emailsScanned: 318,
    filesScanned: 67,
    slackMessagesScanned: 156,
    brainPages: 41,
    slackChannels: ["#helios-dd"],
    sharepointPath: "meridian.sharepoint.com/sites/helios-dd",
    lastSync: isoMinus(0, 0),
  },
];

export const allProjects: Project[] = [latticePayProject, ...otherProjects];

export const currentUser: Person = meridianTeam[0]; // Maya

// ---------- Briefing / onboarding canned outputs ----------
// These are what would be LLM-generated in a real product. We hardcode them
// but stream the text out token-by-token to feel live.

export const briefingExamples: Record<string, { question: string; answer: string }> = {
  default: {
    question: "What happened on the engagement this week?",
    answer: `## This week on Lattice Pay — EU Market Entry

Three decisions landed and one new risk surfaced. Here's the picture:

### Decisions
- **Lithuania over Ireland for the E-Money license.** Diego closed the call with Walkers Dublin on Tuesday and reconciled it with the EBA Q2 guidance. The 3-month Lithuanian timeline beats Ireland's 9-month by enough to overcome the smaller passporting footprint. Ravi confirmed alignment Tue 9:42am.
- **Launch sequence locked: Germany → Netherlands → France.** Sofia's reorder proposal was accepted by Ravi last Thursday. Germany leads on SAM size; Netherlands proves the regulatory passport; France waits for partner traction.
- **UK pushed to Year 2.** Dual-license cost post-Brexit plus longer enterprise sales cycles. Confirmed by Emma on Tuesday.

### Risk to flag
- **MiCA reclassification risk for stablecoin rails.** EBA's Q2 supervisory note suggests Lattice's stablecoin settlement could fall under ART rules in 2027, triggering Significant Issuer designation. Diego flagged Monday. Material implication for the 24-month plan if Lattice keeps that rail in scope.

### Deliverables out the door
- **Adyen pricing teardown — v2.** Priya found a 12 bps margin window in the €1–10M segment incumbents are quietly subsidizing. Her recommendation: undercut by 4 bps in Year 1.
- **Germany TAM validated at €38B by 2028.** Jonas reconciled the McKinsey 2024 baseline against Bundesbank quarterly flows. Emma signed off.

### Open requests
- **Kenji (CFO) asked for 3-year country-level P&Ls** for the top 3 markets. Jonas and Sofia owning jointly, due end of next week.

### What I'd flag for partner discussion
The MiCA risk is the one that benefits most from a partner POV — it could push us to recommend descoping the stablecoin rail entirely from the 24-month plan, which is a big call versus what Lattice's board approved.`,
  },
  regulatory: {
    question: "What's the state of the regulatory workstream?",
    answer: `## Regulatory workstream — current state

**Owner:** Diego Alvarez · **Status:** At risk · **Progress:** 42%

### Where it stands
The headline question — *which license path?* — is now answered: **Lithuania E-Money license**, with Belgian passport for SEPA coverage. Diego closed the gap with Walkers (Dublin) on Tuesday and the recommendation is in front of Ravi.

### What's at risk
The **MiCA reclassification note** EBA published on Monday is the reason status moved from on-track to at-risk. If Lattice keeps the stablecoin settlement rail in scope, they're likely to be designated a Significant Issuer in 2027, with capital requirements that materially change the unit economics.

### Decisions still pending
1. **Stablecoin rail — in or out** of the EU launch scope. Recommendation memo due Friday.
2. **Partner-bank fallback** (Solaris vs Treezor) if Lithuania timeline slips. Diego has a call with Solaris Wed 11am.

### Next milestone
**EBA guidance memo — partner-bank structure**, due June 5th.

### What I'd flag
The Lithuanian regulator is processing applications faster than Ireland but slower than they were 18 months ago. A 4-week buffer past the official "3 months" is realistic. Worth raising with Kenji on the P&L modeling.`,
  },
  team: {
    question: "Are any team members overloaded or blocked?",
    answer: `## Team load — current read

### At capacity
- **Diego (Regulatory).** Two simultaneous pushes: closing the Lithuania recommendation AND drafting the MiCA risk memo. He hasn't asked for help but the timeline for both is tight. Consider deputizing the MiCA memo to Priya — she has the financial-impact context from the pricing teardown.

### Healthy load
- **Jonas (Market Sizing).** On-track. Germany done, France in progress.
- **Priya (Competitive).** On-track. Adyen v2 shipped, Stripe teardown next.
- **Sofia (GTM).** On-track. Channel long-list done, top-12 outreach starting week 11.

### New ask absorbed
Kenji's country-P&L request (Wed) lands jointly on Jonas + Sofia. Plausible — neither is at capacity. Recommend Maya synthesize the model herself given the cross-workstream nature.

### Inbox volume signal
Diego's mail traffic from regulators tripled last week (12 → 36 emails/day). He's processing but it's a leading indicator — if he says yes to a third workstream ask, push back.`,
  },
};

export const onboardingExamples: Record<
  string,
  { newHire: string; workstream: string; doc: string }
> = {
  ws_regulatory: {
    newHire: "Léa Martin",
    workstream: "Regulatory (PSD2, MiCA, EBA)",
    doc: `# Welcome to Lattice Pay — Regulatory workstream

Hi Léa — welcome to the team. This brief gets you to "useful" in about 20 minutes. Iota has been in sync with the project's email, Slack (#lattice-pay-eu and 2 others), and SharePoint folder since week 1, so everything below is current as of this morning.

---

## The project in one paragraph

Lattice Pay is a US B2B cross-border payments platform (~$14B annual volume, Series C). They closed funding in late 2025 with explicit board direction to enter EU before US TAM saturates. We are 12 weeks into a 12-week engagement that defines target markets, regulatory path, competitive positioning, and a 24-month GTM plan. The deliverable is a board-ready document due **next Tuesday**.

## Your workstream

**Regulatory (PSD2, MiCA, EBA).** You take over from Diego Alvarez, who is rotating onto a new engagement next week. Diego will be available for handover questions through Friday.

**Why this workstream exists:** Lattice cannot operate in the EU without either an E-Money license, a partner-bank arrangement, or a banking license. The workstream decides *which path* and lays out the timeline, cost, and risk.

## Where the workstream stands

### What's decided
- **License path:** Lithuania E-Money license, with Belgian passport for SEPA coverage. (Decided Tuesday this week, confirmed by Ravi at Lattice.)
- **Launch sequence:** Germany → Netherlands → France. (Confirmed Thursday last week.)
- **UK:** Year 2, not Year 1.

### What's still open
1. **Stablecoin rail — in or out** of the EU launch scope. EBA published a Q2 supervisory note Monday flagging likely MiCA reclassification (Significant Issuer designation in 2027). Recommendation memo due Friday — this will be your first deliverable.
2. **Partner-bank fallback decision.** Solaris vs Treezor if the Lithuanian timeline slips. Diego has a Solaris intro call Wednesday — joining that call would be a good start.

### Next milestone
**EBA guidance memo — partner-bank structure**, due June 5th.

## People you'll work with most

- **Maya Chen** (Engagement Manager, your manager on this) — weekly 1:1 Mondays 9am.
- **Diego Alvarez** (outgoing owner) — book a 60-min handover this week.
- **Ravi Subramanian** (VP International, Lattice) — your primary client contact for regulatory questions. Tuesday weekly call at 10am ET.
- **Kenji Yamada** (CFO, Lattice) — relevant for license-cost modeling.
- **Walkers (Dublin)** — outside counsel. Diego's contact is partner Aoife Brennan.

## How Lattice operates (cultural notes)

- **Ravi prefers structured options** over open recommendations. Bring 2–3 options with trade-offs, never a single answer.
- **Kenji wants numbers.** Anything regulatory that hits the P&L gets a model.
- **Lattice's board reviews Q3.** Anything that lands on the recommendation list must be defensible at that level.

## Your first week

1. **Monday** — Handover with Diego. Read the MiCA risk memo draft (in shared folder, "Regulatory > Risks").
2. **Tuesday** — Sit in on the weekly Lattice call. Listen mode.
3. **Wednesday** — Join Diego's Solaris call. Take notes on partner-bank structure.
4. **Thursday** — Own the stablecoin-rail recommendation memo (Maya to review).
5. **Friday** — Memo delivered to Ravi.

## You're now subscribed

Iota is now in sync with your email, the project Slack channels, and the shared SharePoint folder. Anything you read, send, or save that matches the project context feeds the project brain automatically — so the team always has the latest, and your future onboarding partner inherits this same brief without you having to write a thing.

Welcome aboard. Reach out anytime.

— Maya`,
  },
  ws_market: {
    newHire: "Léa Martin",
    workstream: "Market Sizing & TAM",
    doc: `# Welcome to Lattice Pay — Market Sizing workstream

Hi Léa — welcome to the team. This brief gets you to "useful" in about 20 minutes.

---

## The project in one paragraph

Lattice Pay is a US B2B cross-border payments platform (~$14B annual volume, Series C). They are entering Europe. We are 12 weeks into a 12-week engagement that defines target markets, regulatory path, competitive positioning, and a 24-month GTM plan.

## Your workstream

**Market Sizing & TAM.** You take over from Jonas Weber, who is rotating onto a new engagement. The workstream builds defensible TAM/SAM for B2B cross-border payments in EU-27 + UK, by segment (SMB, mid-market, enterprise), validated against 3rd party datasets.

## Where the workstream stands

### What's locked
- **Germany SAM: €38B by 2028, ±8%.** Cross-checked against Bundesbank quarterly cross-border flows. Validated by Emma (Lattice) on Friday.
- **Methodology:** Top-down (McKinsey 2024 baseline) cross-validated bottom-up (Eurostat firmographics × cross-border payment frequency per company-size band).

### In flight
- **France sizing** — Jonas was 2/3 through. Hand-off Monday.
- **Netherlands sizing** — methodology agreed, data pulled, not yet in the model.

### Open ask
- **Kenji (CFO) requested 3-year country-level P&Ls** for the top 3 markets. Co-owned with Sofia (GTM). Due end of next week. You inherit Jonas's share.

## People you'll work with most

- **Maya Chen** — your manager. Mondays 9am 1:1.
- **Jonas Weber** — outgoing owner. Book a handover this week.
- **Sofia Lindqvist** — your co-owner on the country P&Ls.
- **Emma Hollis** (Head of Strategy, Lattice) — validates every sizing output. Ping her on email; she's responsive.

## How Lattice operates

- **Show the work.** Every TAM line is defended against at least two sources. Emma will catch unsupported numbers in a heartbeat.
- **Kenji wants country-level P&Ls** for every sizing recommendation. Build the model so it extends to NL and FR with parameter swaps, not new tabs.

## Your first week

1. **Monday** — Handover with Jonas. Walk through the Germany model.
2. **Tuesday** — Sit in on the weekly Lattice call.
3. **Wed–Thu** — Finish France sizing.
4. **Friday** — First pass on country P&L (your share of the joint with Sofia).

## You're now subscribed

Iota is now in sync with your email, the project Slack channels, and the shared SharePoint folder. Everything project-relevant feeds the project brain automatically.

Welcome aboard.

— Maya`,
  },
  ws_competitive: {
    newHire: "Léa Martin",
    workstream: "Competitive Landscape",
    doc: `# Welcome to Lattice Pay — Competitive Landscape workstream

Hi Léa — welcome.

---

## The project in one paragraph

Lattice Pay enters Europe. 12-week engagement defining target markets, regulatory path, competitive positioning, and 24-month GTM plan.

## Your workstream

**Competitive Landscape.** You take over from Priya Raman. The workstream maps incumbents (Adyen, Stripe, Banking Circle) and challengers, quantifies share, pricing, fee structures, and identifies product gaps Lattice can exploit.

## Where the workstream stands

### Locked
- **Competitive matrix v1** — 14 players, 6 dimensions (pricing, license footprint, B2B share, integration depth, settlement speed, FX margin).
- **Adyen pricing teardown v2** — Key finding: 12 bps margin window in the €1–10M segment incumbents subsidize. Recommendation: undercut by 4 bps in Year 1.

### In flight
- **Stripe SMB pricing teardown** — Priya was scoping. Due **June 2**.
- **Banking Circle deep-dive** — not started.

## People

- **Maya Chen** — manager. Mondays 9am.
- **Priya Raman** — outgoing owner. Handover this week.
- **Jonas Weber** — Market Sizing. Heavy cross-talk; competitive shares feed his SAM splits.

## How Lattice operates

- **Ravi loves a sharp competitive thesis.** Avoid "this is the landscape." Give him "this is where the incumbent is structurally weak and we can win."
- **Numbers over adjectives.** Margin bps, settlement-day SLAs, contract length. Not "strong" or "weak."

## Your first week

1. **Monday** — Handover with Priya.
2. **Tuesday** — Weekly Lattice call.
3. **Wed–Thu** — Stripe SMB teardown.
4. **Friday** — Deliver to Maya.

## You're now subscribed

Iota is now in sync with your email, project Slack channels, and shared SharePoint folder.

Welcome aboard.

— Maya`,
  },
  ws_gtm: {
    newHire: "Léa Martin",
    workstream: "GTM & Partnerships",
    doc: `# Welcome to Lattice Pay — GTM & Partnerships workstream

Hi Léa — welcome.

---

## The project in one paragraph

Lattice Pay enters Europe. 12-week engagement to define target markets, regulatory path, competitive positioning, and the 24-month GTM plan.

## Your workstream

**GTM & Partnerships.** You take over from Sofia Lindqvist. The workstream defines the launch sequence, hiring plan, and partner channel strategy.

## Where the workstream stands

### Locked
- **Launch sequence: Germany → Netherlands → France.** Decided Thursday last week. UK pushed to Year 2.
- **Channel partner long-list (47 firms)** — SAP/Oracle ecosystem, regional accounting platforms (DATEV, Sage), embedded-finance enablers. Top 12 flagged.

### In flight
- **Channel partner shortlist** — Sofia was narrowing to top 5. Due **June 8**.
- **3-year country P&L** — joint with Market Sizing. Your share is the GTM cost build (sales hiring, partner enablement, marketing).

## People

- **Maya Chen** — manager. Mondays 9am.
- **Sofia Lindqvist** — outgoing owner.
- **Jonas Weber** — your co-owner on the country P&L (he covers revenue; you cover cost).
- **Ravi Subramanian** (Lattice VP International) — primary GTM contact.

## How Lattice operates

- **Ravi is a 90-day-plan person.** GTM proposals that don't have a clear first-90-days slide will get sent back.
- **Channel partners ≠ resellers.** Lattice treats channel as integration-led, not commission-led. Make sure your shortlist reflects that.

## Your first week

1. **Monday** — Handover with Sofia.
2. **Tuesday** — Lattice weekly.
3. **Wed–Thu** — Channel shortlist (top 12 → top 5).
4. **Friday** — Your slice of country P&L.

## You're now subscribed

Iota is now in sync with your email, project Slack channels, and shared SharePoint folder.

Welcome aboard.

— Maya`,
  },
};
