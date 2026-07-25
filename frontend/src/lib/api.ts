/**
 * Live API client for the Admin Center.
 *
 * The site is a static export served by Caddy, which ALSO reverse-proxies
 * `/api/*` and `/auth/*` to the FastAPI backend on the SAME origin. So a plain
 * relative `fetch` carries the first-party session cookie automatically — no
 * CORS, no bearer tokens, no base URL. (`credentials: "include"` is belt-and-
 * suspenders; same-origin already sends the cookie.)
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Turn an error response body into a readable string. FastAPI sends `detail`
 *  as a plain string for HTTPException, but as an ARRAY of {loc,msg,type} objects
 *  for 422 validation errors — String()-ing that yields "[object Object]", so
 *  pull each `msg` out instead. */
function errorDetail(body: unknown, res: Response): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string" && d) return d;
    if (Array.isArray(d)) {
      const msgs = d
        .map((e) =>
          e && typeof e === "object" && "msg" in e
            ? String((e as { msg: unknown }).msg)
            : String(e),
        )
        .filter(Boolean);
      if (msgs.length) return msgs.join("; ");
    } else if (d && typeof d === "object") {
      return JSON.stringify(d);
    } else if (d != null) {
      return String(d);
    }
  }
  if (typeof body === "string" && body) return body;
  return res.statusText || `Request failed (${res.status}).`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      ...init,
    });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "Network error.");
  }

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, errorDetail(body, res));
  }

  return body as T;
}

// --- response shapes (mirror backend src/api/app.py) ------------------------

export interface Me {
  email: string | null;
  org: string;
  org_id: number;
  role: string;
  // 'native' = email/password/authenticator sign-in (invite by email);
  // 'entra' = Microsoft SSO.
  auth_method: "native" | "entra";
}

export type AuthMethod = "native" | "entra";

// What the onboarding step returns once, when a freshly-invited user enrols an
// authenticator: the otpauth URI, a server-rendered QR PNG (data URI, so the
// frontend needs no QR library), and the one-time backup codes to write down.
export interface TotpEnrollment {
  otpauth_uri: string;
  qr_data_uri: string;
  backup_codes: string[];
}

export interface CapacityEstimate {
  emails: number | null;
  files: number | null;
}

export interface Credits {
  org: string;
  credits_granted: string;
  credits_spent: string;
  balance: string;
  fraction_used: number;
  out_of_credits: boolean;
  low_balance: boolean;
  estimate: CapacityEstimate;
  // Customer-facing cost of processing one average email (already marked up).
  // Used to quote a backfill up front. null when the price book is empty.
  cost_per_email: string | null;
}

export interface CreditsHistoryPoint {
  period_start: string; // ISO date (period start)
  spent: string; // credits consumed in this period
  remaining: string; // running balance at the end of this period
}

export interface CreditsHistory {
  org: string;
  granularity: "day" | "week";
  series: CreditsHistoryPoint[];
}

export interface AddCreditsResult {
  org: string;
  credits_granted: string;
  credits_spent: string;
  balance: string;
}

// How every email branched through the two-layer scope gate. Layer 1 sorts
// into all four buckets; Layer 2 is the redzone-vs-in_scope runoff under the
// in_scope branch. The Layer-2 in_scope leaf equals `emails_analyzed`.
export interface ScopeTree {
  layer1: {
    in_scope: number;
    redzone: number;
    spam: number;
    out_of_scope: number;
  };
  layer2: {
    in_scope: number;
    redzone: number;
  };
}

export interface Usage {
  org: string;
  emails_analyzed: number; // in-scope emails captured (passed the scope gate)
  emails_processed: number; // of those, how many comprehended into the brain
  files_analyzed: number;
  entities_mapped: number;
  connections: number;
  questions_answered: number;
  scope_tree: ScopeTree;
}

export interface UserUsageRow {
  user_id: number | null;
  /** Set only on user_id-null rows: the mailbox the ingestion came from. */
  source_mailbox: string | null;
  email: string | null;
  display_name: string | null;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** Customer-facing dollar amount as a decimal string, e.g. "1.23" */
  total_cost: string;
  ingestion_cost: string;
  qa_cost: string;
  ingestion_tokens: number;
  qa_tokens: number;
}

export interface PlatformUsageRow {
  org_id: number;
  org_slug: string;
  org_name: string;
  user_id: number | null;
  /** Set only on user_id-null rows: the mailbox the ingestion came from. */
  source_mailbox: string | null;
  email: string | null;
  display_name: string | null;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  /** Raw internal cost as a decimal string, e.g. "0.0042" */
  total_cost: string;
  ingestion_cost: string;
  qa_cost: string;
  ingestion_tokens: number;
  qa_tokens: number;
}

/** One calendar day of split ingestion-vs-Q&A spend. Costs are decimal
 *  strings (customer-facing for admin, raw for platform). */
export interface UsageTimeseriesPoint {
  period_start: string; // "YYYY-MM-DD"
  ingestion_cost: string;
  qa_cost: string;
  ingestion_tokens: number;
  qa_tokens: number;
}

export interface CaptureRun {
  mailbox: string | null;
  started_at: string | null;
  finished_at: string | null;
  fetched: number;
  included: number;
  excluded: number;
  duplicates: number;
  removed: number;
  error: string | null;
  ok: boolean;
}

export interface CaptureDayTotals {
  fetched: number;
  included: number;
  excluded: number;
  duplicates: number;
  removed: number;
}

export interface CaptureDay extends CaptureDayTotals {
  date: string; // YYYY-MM-DD
}

export interface Ingestion {
  org: string;
  last_sync: { mailbox: string | null; at: string | null } | null;
  last_run: CaptureRun | null;
  // Running tally across today's runs + per-day totals (last 30 days).
  today: CaptureDayTotals;
  daily: CaptureDay[];
}

export interface Connections {
  connected: boolean;
  mcp_tokens: number;
  oauth_grants: number;
  last_activity: string | null;
}

// One row of the Tenant-observability trace: a captured email + its
// comprehension receipt. Comprehension fields are null until the email has
// been processed.
export interface ObservabilityRow {
  id: number;
  // "captured" (in-scope) or "excluded" — disambiguates ids across the two
  // source tables (use `${kind}-${id}` as a React key).
  kind: string;
  fetched_at: string | null;
  sender: string | null;
  recipients: string[];
  subject: string | null;
  body_text: string | null;
  // in_scope | redzone | spam | out_of_scope
  triage_bucket: string;
  // Why the scope gate rejected it (excluded rows only); null for in-scope.
  triage_reason: string | null;
  duplicate_hits: number;
  processed_at: string | null;
  entities: number | null;
  relationships: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  llm_calls: number | null;
  model: string | null;
  cost: number | null;
  currency: string;
  // True when a comprehend debug trace exists to expand (relationship-agent
  // decisions, entities, and the English text the agents saw).
  has_debug: boolean;
  // Mail source type this row came from ("graph" | "imap" | null) — used to split
  // the Ingress observability view by source.
  provider: string | null;
}

// --- comprehend relationship debug trace (one email) ------------------------

export interface RelSubjectTrace {
  subject: { type: string; name: string };
  candidates: string[];
  // What the model literally returned (may name objects not in `candidates`).
  raw_model_output: { predicate?: string; object?: string }[];
  // Objects the model named that aren't real candidate entities (dropped).
  dropped_unknown_object: { predicate: string; object: string }[];
  // Triples accepted by the agent (valid object), before normalization.
  accepted_triples: { predicate: string; object: string; object_type: string }[];
  // Each accepted predicate's raw → canonical decision (canonical null = dropped).
  normalization: { raw: string; canonical: string | null }[];
  // Final stored triples (post-normalization).
  final: { predicate: string; object: string; object_type: string }[];
}

// One evaluated entity pair (pairwise RelationshipAgent).
export interface RelPairTrace {
  pair: [string, string];
  result:
    | { predicate: string; subject: string; object: string; object_type?: string }
    | null;
}

export interface RelationshipTrace {
  email_text: string;
  entities: { type: string | null; name: string | null; email: string | null }[];
  structural_edges: { subject: string; predicate: string; object: string }[];
  // New pairwise pipeline fields:
  direction?: string;
  third_party?: {
    bucket?: string;
    person_name?: string | null;
    company_name?: string | null;
    address?: string;
  };
  pairs?: RelPairTrace[];
  // Legacy per-subject trace (pre-pairwise rows).
  subjects?: RelSubjectTrace[];
}

export type DiligenceMode = "anchored" | "capped" | "exhaustive";

export interface ComprehendSettings {
  relationship_diligence: DiligenceMode;
  // Which per-email downstream agents receive third-party brain-page context.
  context_agents: Record<string, boolean>;
  context_max_neighbors: number;
  // Whether the comprehend agents run over Google Drive documents (entities +
  // graph). Off by default — gates metered LLM work; chunks/retrieval are always on.
  drive_comprehend_enabled: boolean;
}

// One row of the per-document cost rollup (Drive files comprehended into the brain).
export interface DocumentCostRow {
  filename: string;
  comprehensions: number;
  input_tokens: number;
  output_tokens: number;
  // Entities + relationships extracted from this document, LLM calls made, and
  // the model that did the most token work on it.
  entities: number;
  relationships: number;
  llm_calls: number;
  model: string | null;
  cost: number;
}

export interface DocumentCost {
  currency: string;
  rows: DocumentCostRow[];
}

export interface ObservabilityPage {
  rows: ObservabilityRow[];
  total: number;
  limit: number;
  offset: number;
}

// Egress · Ask: one asked question with its synthesis token usage + cost.
// Tokens/model/cost are null for questions with no matching usage event (e.g.
// replayed from history before per-question metering existed).
export interface QuestionCostRow {
  id: number;
  question: string;
  created_at: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  llm_calls: number | null;
  model: string | null;
  cost: number | null;
}

export interface QuestionCostPage {
  rows: QuestionCostRow[];
  total: number;
  limit: number;
  offset: number;
  currency: string;
}

// Egress · Delivery: one DeliveryAgent sync (agenda inference) per pool refresh.
export interface DeliverySyncRow {
  occurred_at: string | null;
  email: string | null;
  display_name: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  llm_calls: number;
  cost: number | null;
  model: string | null;
  currency: string;
}

export interface DeliverySyncPage {
  rows: DeliverySyncRow[];
  total: number;
  limit: number;
  offset: number;
}

// A mailbox this workspace pulls mail from (Admin Center "Mail sources").
// The sync pulls all of the mailbox's folders (minus junk/deleted/drafts), so
// there is no per-folder setting here. A source is either a Microsoft Graph
// mailbox (read with the workspace's app credentials) or a generic IMAP mailbox
// (read with a per-source host + username + app password). The encrypted app
// password is never returned — only the non-secret connection bits are.
export type CaptureProvider = "graph" | "imap" | "gdrive";

export interface CaptureSource {
  id: number;
  mailbox: string;
  enabled: boolean;
  provider: CaptureProvider;
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
  imap_use_ssl: boolean | null;
  created_at: string | null;
  created_by: string | null;
  // Per-mailbox capture stats (GET /api/admin/sources merges these in). This is
  // the TOTAL captured for the mailbox — live sync and manual backfill are not
  // separable — so surface it as "captured", never "backfilled".
  captured: number;
  oldest_email: string | null; // ISO date of the oldest captured email
  last_capture: string | null; // ISO timestamp of the most recent capture
  // Google Drive source bits (provider === 'gdrive'); null for email sources.
  gdrive_folder_id: string | null;
  gdrive_folder_name: string | null;
  gdrive_drive_id: string | null;
}

// The email customers share a Drive folder with, + whether the shared service
// account is configured on the server at all.
export interface GdriveShareTarget {
  email: string;
  configured: boolean;
}

// Verdict from the live Drive folder access check (before saving).
export type GdriveProbeStatus =
  | "readable"
  | "auth_failed"
  | "not_configured"
  | "error";

export interface GdriveProbeResult {
  status: GdriveProbeStatus;
  detail: string;
  folder_id?: string;
}

export interface Sources {
  org: string;
  sources: CaptureSource[];
}

// What the admin fills in to add a generic IMAP mailbox. The app password is
// sent once over HTTPS and stored encrypted at rest; it is never read back.
export interface ImapSourceInput {
  host: string;
  username: string;
  password: string;
  port?: number;
  use_ssl?: boolean;
}

// Verdict from a live IMAP connection test ("test connection" button), before
// anything is saved. "readable" = logged in and opened the inbox.
export type ImapProbeStatus = "readable" | "auth_failed" | "error";

export interface ImapTestResult {
  status: ImapProbeStatus;
  detail: string;
}

// One mailbox's live access verdict from Microsoft (the in-sync flag).
export type AccessStatus = "readable" | "blocked" | "not_found" | "error";

export interface MailboxAccess {
  mailbox: string;
  status: AccessStatus;
  detail: string;
}

export interface SourcesAccess {
  org: string;
  connector_configured: boolean;
  detail?: string;
  checked: MailboxAccess[];
}

// One mailbox to backfill, with its own window (since date + cap).
export interface BackfillItem {
  source_id: number;
  since: string | null;
  max_count: number;
}

// One mailbox's slice of a backfill run, echoing the window that was used.
export interface BackfillMailboxResult {
  mailbox: string;
  folders: number; // how many folders were swept for this mailbox
  since: string;
  max_count: number;
  result: {
    run_id: number;
    mailbox: string;
    fetched: number;
    included: number;
    excluded: number;
    duplicates: number;
    removed: number;
  };
}

// Result of a manual historical backfill, possibly across several mailboxes in
// one run. `totals` sums every mailbox; `results` is the per-mailbox breakdown.
export interface BackfillResult {
  org: string;
  results: BackfillMailboxResult[];
  totals: {
    fetched: number;
    included: number;
    excluded: number;
    duplicates: number;
    removed: number;
  };
}

export interface ScopeBucket {
  description: string;
  anchors: string[];
  action?: string;
}

// Whether an admin has signed off on this workspace's triage scope policy.
// Capture (live sync AND manual backfill) stays paused until approved is true.
export interface ScopeApproval {
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
}

export interface Scope {
  org: string;
  margin: number;
  include_bucket: string;
  editable_buckets: string[];
  buckets: Record<string, ScopeBucket>;
  approval?: ScopeApproval;
}

// Where a workspace is in the guided onboarding flow: Connect -> Triage ->
// Brain -> Activate. Mirrors backend GET /api/admin/onboarding.
// The wizard-completion stamp returned by the complete/reopen endpoints.
export interface OnboardingStamp {
  onboarded: boolean;
  onboarded_at: string | null;
  onboarded_by: string | null;
}

export interface Onboarding {
  org: string;
  onboarded: boolean;
  onboarded_at: string | null;
  onboarded_by: string | null;
  sources_connected: boolean;
  sources_total: number;
  sources_enabled: number;
  scope_approved: boolean;
  scope_approved_at: string | null;
  scope_approved_by: string | null;
  ontology_defined: boolean;
  ontology_entity_types: number;
  // The real-state bar for leaving onboarding: the brain is initialized once
  // capture AND comprehend have produced something.
  brain_initialized: boolean;
  emails_analyzed: number;
  entities_mapped: number;
  // True when the server has DEV_SKIP_BRAIN_CHECK set. Shows a bypass button
  // in the wizard so the Admin Center can be reached without a real backfill.
  dev_skip_brain_check: boolean;
}

export interface ScopeBucketEdit {
  anchors?: string[];
}

export interface ScopeUpdate {
  margin?: number;
  buckets?: Record<string, ScopeBucketEdit>;
}

// The customer-defined ontology: the entity types (with their structured
// fields) and relationship types the comprehend agents detect. Mirrors backend
// GET/PUT /api/admin/ontology.
export interface OntologyField {
  field_key: string;
  label: string;
  description: string;
  is_list: boolean;
}

export interface OntologyEntityType {
  key: string;
  label: string;
  description: string;
  page_folder: string | null;
  fields: OntologyField[];
}

export interface OntologyRelationshipType {
  key: string;
  label: string;
  description: string;
  subject_type: string | null; // null = connects any type
  object_type: string | null;
}

export interface Ontology {
  org: string;
  entity_types: OntologyEntityType[];
  relationship_types: OntologyRelationshipType[];
}

export interface OntologyUpdate {
  entity_types: OntologyEntityType[];
  relationship_types: OntologyRelationshipType[];
}

// A hand-placed anchor entity: a brain page an admin pre-created at onboarding
// so later email mentions canonicalize onto it instead of spawning duplicates.
export interface StarterEntity {
  page_path: string;
  entity_type: string;
  name: string;
  description: string;
  // The workspace's center of gravity (one per workspace) + its email address.
  is_principal: boolean;
  email: string;
}

export interface StarterEntities {
  org: string;
  starters: StarterEntity[];
}

// A single cited snippet behind an answer. `method` says how it surfaced:
// "vector" (semantic/keyword hit) or "graph_neighbor" (reached by walking one
// hop from a hit). Most fields are optional because the two methods carry
// slightly different metadata.
export interface QaSource {
  method: "vector" | "graph_neighbor" | "principal";
  text: string;
  section?: string | null;
  date?: string | null;
  // The brain entity this snippet describes. `entity_id` matches a node id in
  // the knowledge graph, so the Ask page can fly to / highlight cited entities.
  entity_id?: number | null;
  entity?: { type?: string | null; name?: string | null; page_path?: string | null } | null;
  predicate?: string | null;
  direction?: "in" | "out" | null;
}

export interface QaAnswer {
  question_id: number;
  answer: string;
  sources: QaSource[];
}

// The whole tenant brain as a knowledge graph: entity nodes + the relationships
// between them. `val` is the node's degree (drives its size in the 3D graph),
// `description` (when present) feeds the hover tooltip. Ids are strings so they
// can key the force-graph and match QaSource.entity_id (stringified).
export interface BrainGraphNode {
  id: string;
  label: string;
  type: string;
  group: string;
  description?: string | null;
  // The page_path of this entity's brain page — lets a clicked node open the
  // full page detail. Null for the rare entity with no stored page.
  page_path?: string | null;
  val?: number;
}

// A full brain page as the comprehend pipeline wrote it. `data` mirrors the
// stored JSON: structured frontmatter fields, a prose description, a dated
// timeline, and the entity's outgoing relationship triples.
export interface BrainPageData {
  frontmatter: Record<string, unknown>;
  description: string;
  timeline: { date: string; entry: string }[];
  relationships: { predicate: string; object: string }[];
}

export interface BrainPage {
  page_path: string;
  entity_type: string;
  name: string;
  data: BrainPageData;
}

// One to-do the Delivery tab surfaces — an action the logged-in user must take
// in the next 24h, inferred from their brain context. `suggested_ask` is the
// concrete instruction Indigo Iota pre-fills when the user delegates it.
export type DeliveryUrgency = "critical" | "soon" | "today";
export interface DeliveryTodo {
  id: string;
  title: string;
  context: string;
  source: string;
  due_in_hours: number;
  urgency: DeliveryUrgency;
  suggested_ask: string;
}
// A proactive next step surfaced when nothing is strictly due — same delegate
// flow as a to-do, but no deadline/urgency.
export interface DeliverySuggestion {
  id: string;
  title: string;
  context: string;
  source: string;
  suggested_ask: string;
}
export interface DeliveryPool {
  todos: DeliveryTodo[];
  suggestions: DeliverySuggestion[];
  refreshed_at: string | null;
}

// A captured Google Drive document: its filename + Drive path/link, whether it's
// been comprehended into the brain, and the full MarkItDown-converted Markdown
// (what the agents + retrieval actually read). Documents live only as chunks, so
// this comes straight from the captured event, not a brain page.
export interface DocumentFile {
  file_id: string;
  filename: string;
  markdown: string;
  modified_time: string | null;
  comprehended: boolean;
  path: string | null;
  web_view_link: string | null;
  mime_type: string | null;
}

// A row in the Ask history list (cheap — no answer body).
export interface QaQuestionSummary {
  id: number;
  question: string;
  created_at: string | null;
}

// A replayed past Q&A: the stored answer + sources, no LLM cost.
export interface QaQuestionDetail {
  id: number;
  question: string;
  answer: string;
  sources: QaSource[];
  created_at: string | null;
}

export interface BrainGraphLink {
  source: string;
  target: string;
  label?: string;
}

export interface BrainGraph {
  nodes: BrainGraphNode[];
  links: BrainGraphLink[];
}

// --- Control Tower (platform owner) shapes ---------------------------------

export interface Tenant {
  slug: string;
  name: string;
  status: string;
  region: string | null;
  db_name: string | null;
  schema_version: string | null;
  sso_tenant_id: string | null;
  sso_enabled: boolean;
  sso_configured: boolean;
  members: number;
  // 'native' = email + password + authenticator; 'entra' = Microsoft SSO.
  auth_method: AuthMethod;
  // Per-workspace customer markup override (raw cost × this = what the customer
  // pays). null = use the global default.
  markup_factor: number | null;
}

// The Control Tower's view of one workspace's customer markup.
export interface TenantMarkup {
  slug: string;
  factor: number | null; // the override, or null when on the default
  effective: number; // what's actually applied (override or default)
  default: number;
  min: number;
  max: number;
  has_funded_credits: boolean;
}

export interface ProvisionResult {
  org_id: number;
  slug: string;
  db_name: string;
  db_created: boolean;
  migrations_applied: number;
  schema_version: string;
  admin_email: string;
}

export interface WorkspaceErasure {
  slug: string;
  org_id: number;
  db_name: string;
  members_removed: number;
  users_deleted: number;
}

export interface ConsentUrls {
  login_url: string;
  connector_url: string;
  redirect_uri: string;
  // False when the matching app id is missing from server config — the link is
  // then empty and the panel warns instead of offering a dead link.
  login_configured: boolean;
  connector_configured: boolean;
}

export interface AccessPolicyCommand {
  command: string;
  test_command: string;
  // The mailboxes the command covers — this admin's enabled sources. Echoed back
  // so the panel can show exactly what the policy will scope.
  mailboxes: string[];
  // False when the server has no connector app id set — the command then carries
  // a placeholder instead of a real GUID, so the panel can warn rather than lie.
  connector_configured: boolean;
}

export interface SsoVerify {
  ok: boolean;
  error?: string;
  tenant_id?: string;
  client_id?: string;
  redirect_uri?: string;
  issuer?: string;
  redirect_host_matches?: boolean;
  login_url?: string;
}

export interface Member {
  email: string;
  role: string;
  linked: boolean;
}

export interface ConnectorStatus {
  tenant_id: string;
  client_id: string;
  auth_mode: "certificate" | "secret" | "none";
  ready: boolean;
}

export interface DbDatabase {
  key: string;
  label: string;
  db_name: string;
  kind: "control" | "tenant";
  slug?: string;
}

export interface DbTable {
  name: string;
  row_count: number;
}

export interface DbColumn {
  name: string;
  type: string;
  masked: boolean;
}

export interface DbRows {
  table: string;
  columns: DbColumn[];
  rows: (string | number | boolean | null | object)[][];
  total: number;
  limit: number;
  offset: number;
}

// --- endpoints --------------------------------------------------------------

export const api = {
  me: () => request<Me>("/auth/me"),

  devLogin: (slug: string, email: string) =>
    request<{ ok: boolean; org: string; role: string; email: string }>(
      "/auth/dev-login",
      { method: "POST", body: JSON.stringify({ slug, email }) },
    ),

  logout: () => request<unknown>("/auth/logout", { method: "POST" }),

  // Irreversible: drops this workspace's tenant DB + wipes its personal data.
  // `confirm` must equal the caller's own workspace slug. Server clears the
  // session cookie on success, so the caller should redirect to login after.
  deleteWorkspace: (confirm: string) =>
    request<WorkspaceErasure>(
      `/api/admin/workspace?confirm=${encodeURIComponent(confirm)}`,
      { method: "DELETE" },
    ),

  credits: () => request<Credits>("/api/admin/credits"),

  creditsHistory: (granularity: "day" | "week" = "day") =>
    request<CreditsHistory>(
      `/api/admin/credits/history?granularity=${granularity}`,
    ),

  addCredits: (amount: number) =>
    request<AddCreditsResult>("/api/admin/credits/add", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),

  usage: () => request<Usage>("/api/admin/usage"),

  usageByUser: (days = 30) =>
    request<{ org: string; rows: UserUsageRow[] }>(
      `/api/admin/usage/by-user?days=${days}`,
    ),

  usageTimeseries: (days = 30) =>
    request<{ org: string; days: number; series: UsageTimeseriesPoint[] }>(
      `/api/admin/usage/timeseries?days=${days}`,
    ),

  ingestion: () => request<Ingestion>("/api/admin/ingestion"),

  connections: () => request<Connections>("/api/admin/connections"),

  observability: (
    limit = 50,
    offset = 0,
    opts?: { sort?: string; dir?: "asc" | "desc"; q?: string; provider?: string },
  ) => {
    const p = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (opts?.sort) p.set("sort", opts.sort);
    if (opts?.dir) p.set("dir", opts.dir);
    if (opts?.q) p.set("q", opts.q);
    if (opts?.provider) p.set("provider", opts.provider);
    return request<ObservabilityPage>(`/api/admin/observability?${p.toString()}`);
  },

  // Per-document token + cost rollup (Drive files comprehended into the brain).
  observabilityByDocument: () =>
    request<DocumentCost>("/api/admin/observability/by-document"),

  // Egress · Ask: per-question token usage + cost (newest first).
  observabilityQuestions: (limit = 50, offset = 0) =>
    request<QuestionCostPage>(
      `/api/admin/observability/questions?limit=${limit}&offset=${offset}`,
    ),

  // Egress · Delivery: DeliveryAgent sync (agenda inference) cost per refresh.
  observabilityDelivery: (limit = 50, offset = 0) =>
    request<DeliverySyncPage>(
      `/api/admin/observability/delivery?limit=${limit}&offset=${offset}`,
    ),

  // The comprehend debug trace for one email (relationship-agent decisions).
  relationshipTrace: (capturedEventId: number) =>
    request<{ captured_event_id: number; trace: RelationshipTrace }>(
      `/api/admin/observability/relationship-trace?captured_event_id=${capturedEventId}`,
    ),

  // Comprehend "Diligence" config for this workspace.
  comprehendSettings: () =>
    request<ComprehendSettings>("/api/admin/comprehend-settings"),
  updateComprehendSettings: (body: Partial<ComprehendSettings>) =>
    request<ComprehendSettings>("/api/admin/comprehend-settings", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  sources: () => request<Sources>("/api/admin/sources"),

  // Live check against Microsoft: which enabled mailboxes are actually readable
  // (i.e. in the customer's Exchange access policy) and which are blocked.
  sourcesAccess: () => request<SourcesAccess>("/api/admin/sources/access"),

  // The Exchange Online command that grants the connector access to exactly the
  // enabled mailboxes. The admin names the scope group; the mailbox list and the
  // connector app id are filled in server-side, so this is the one place mailbox
  // access lives.
  accessPolicyCommand: (scope: string) =>
    request<AccessPolicyCommand>("/api/admin/access-policy-command", {
      method: "POST",
      body: JSON.stringify({ scope }),
    }),

  // The static Microsoft admin-consent link that grants our connector app
  // mail access. Same link for every customer (built from the shared connector
  // app id server-side); the customer's Global Admin clicks it to consent.
  mailConsentUrl: () =>
    request<{ url: string; configured: boolean }>("/api/admin/mail-consent-url"),

  addSource: (mailbox: string) =>
    request<Sources>("/api/admin/sources", {
      method: "POST",
      body: JSON.stringify({ mailbox }),
    }),

  // Try IMAP credentials live without saving — powers the "test connection"
  // button so the admin can confirm host + app password before registering.
  testImapSource: (input: ImapSourceInput) =>
    request<ImapTestResult>("/api/admin/sources/imap/test", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Register (or update) a generic IMAP mailbox. Idempotent on the username;
  // the app password is encrypted at rest before it touches the database.
  addImapSource: (input: ImapSourceInput) =>
    request<Sources>("/api/admin/sources/imap", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // --- Google Drive source (connect-only v0) ---
  // The service-account email to share a folder with (shown in the Connect modal).
  gdriveShareTarget: () =>
    request<GdriveShareTarget>("/api/admin/sources/gdrive/share-target"),

  // Live "can we read this folder?" check without saving.
  testGdriveSource: (url: string) =>
    request<GdriveProbeResult>("/api/admin/sources/gdrive/test", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  // Connect a Drive folder: verifies access server-side, then stores it. Rejects
  // (400) with a "share it with us" message if we can't read the folder yet.
  addGdriveSource: (url: string) =>
    request<Sources>("/api/admin/sources/gdrive", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  toggleSource: (id: number, enabled: boolean) =>
    request<Sources>(`/api/admin/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),

  removeSource: (id: number) =>
    request<Sources>(`/api/admin/sources/${id}`, { method: "DELETE" }),

  backfill: (items: BackfillItem[]) =>
    request<BackfillResult>("/api/admin/backfill", {
      method: "POST",
      body: JSON.stringify({ items }),
    }),

  scope: () => request<Scope>("/api/admin/scope"),

  updateScope: (update: ScopeUpdate) =>
    request<Scope>("/api/admin/scope", {
      method: "PUT",
      body: JSON.stringify(update),
    }),

  // Sign off on the scope policy — unpauses capture (sync + backfill).
  approveScope: () =>
    request<{ org: string; approval: ScopeApproval }>(
      "/api/admin/scope/approve",
      { method: "POST" },
    ),

  // Where this workspace is in the guided onboarding flow.
  onboarding: () => request<Onboarding>("/api/admin/onboarding"),

  // Finish the once-per-tenant wizard — switches to the steady-state dashboard.
  completeOnboarding: () =>
    request<{ org: string; onboarding: OnboardingStamp }>(
      "/api/admin/onboarding/complete",
      { method: "POST" },
    ),

  // Re-run the wizard — drops the Admin Center back into guided setup.
  reopenOnboarding: () =>
    request<{ org: string; onboarding: OnboardingStamp }>(
      "/api/admin/onboarding/reopen",
      { method: "POST" },
    ),

  ontology: () => request<Ontology>("/api/admin/ontology"),

  updateOntology: (update: OntologyUpdate) =>
    request<Ontology>("/api/admin/ontology", {
      method: "PUT",
      body: JSON.stringify(update),
    }),

  starterEntities: () =>
    request<StarterEntities>("/api/admin/starter-entities"),

  addStarterEntity: (
    entity_type: string,
    name: string,
    description?: string,
    opts?: { is_principal?: boolean; email?: string },
  ) =>
    request<StarterEntities>("/api/admin/starter-entities", {
      method: "POST",
      body: JSON.stringify({
        entity_type,
        name,
        description: description ?? null,
        is_principal: opts?.is_principal ?? false,
        email: opts?.email || null,
      }),
    }),

  // Edit a placed anchor — including changing its type (Person → Company).
  // `page_path` is the entity's current identity; the new type/name may re-key it.
  updateStarterEntity: (
    page_path: string,
    entity_type: string,
    name: string,
    description?: string,
    opts?: { is_principal?: boolean; email?: string },
  ) =>
    request<StarterEntities>("/api/admin/starter-entities", {
      method: "PUT",
      body: JSON.stringify({
        page_path,
        entity_type,
        name,
        description: description ?? null,
        is_principal: opts?.is_principal ?? false,
        email: opts?.email || null,
      }),
    }),

  // Remove a placed anchor entirely (its page + graph node).
  removeStarterEntity: (page_path: string) =>
    request<StarterEntities>(
      `/api/admin/starter-entities?page_path=${encodeURIComponent(page_path)}`,
      { method: "DELETE" },
    ),

  // Team / members — tenant-admin self-service (scoped to the caller's own org).
  // The first admin is seeded by the operator in the Control Tower; from there
  // an admin invites teammates here.
  members: () =>
    request<{ org: string; members: Member[] }>("/api/admin/members"),

  addMember: (email: string, role: string) =>
    request<{ member: Member; members: Member[] }>("/api/admin/members", {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),

  // Invite a teammate into a NATIVE-auth org: creates the membership and emails a
  // single-use link to set a password + enrol an authenticator. (Microsoft orgs
  // use addMember instead — those users sign in via SSO, no invite needed.)
  inviteMember: (email: string, role: string) =>
    request<{ ok: boolean; email: string; role: string }>(
      "/api/admin/members/invite",
      { method: "POST", body: JSON.stringify({ email, role }) },
    ),

  // --- native (email + password + authenticator) auth ---
  native: {
    // Which sign-in form to show for a workspace slug. Unknown slugs report
    // 'entra' (so this can't be used to discover which orgs exist).
    method: (slug: string) =>
      request<{ auth_method: AuthMethod }>(
        `/auth/${encodeURIComponent(slug.trim())}/method`,
      ),

    // Step 1 of sign-in: email + password. On success the server sets a
    // short-lived MFA cookie and returns { mfa_required: true }.
    login: (slug: string, email: string, password: string) =>
      request<{ mfa_required: true }>(
        `/auth/${encodeURIComponent(slug.trim())}/native/login`,
        { method: "POST", body: JSON.stringify({ email, password }) },
      ),

    // Step 2 of sign-in: the authenticator (or a backup) code; issues the
    // session on success.
    loginTotp: (slug: string, code: string) =>
      request<{ ok: boolean; org: string; role: string; email: string | null }>(
        `/auth/${encodeURIComponent(slug.trim())}/native/login/totp`,
        { method: "POST", body: JSON.stringify({ code }) },
      ),

    // Begin a password reset. Always succeeds (no account enumeration); a link
    // is emailed only if the address is a member.
    requestReset: (slug: string, email: string) =>
      request<{ ok: boolean }>(
        `/auth/${encodeURIComponent(slug.trim())}/native/reset/request`,
        { method: "POST", body: JSON.stringify({ email }) },
      ),

    // --- invite acceptance (single-use ?token= link) ---
    inviteLookup: (token: string) =>
      request<{ valid: boolean; email?: string }>(
        `/auth/native/invite?token=${encodeURIComponent(token)}`,
      ),

    setPassword: (token: string, password: string) =>
      request<{ ok: boolean }>("/auth/native/onboard/set-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),

    totpBegin: (token: string) =>
      request<TotpEnrollment>("/auth/native/onboard/totp/begin", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),

    // Confirm enrolment with a live code — spends the invite and signs the
    // user in (sets the session cookie).
    totpConfirm: (token: string, code: string) =>
      request<{ ok: boolean; org: string; role: string; email: string | null }>(
        "/auth/native/onboard/totp/confirm",
        { method: "POST", body: JSON.stringify({ token, code }) },
      ),

    // --- password reset (single-use ?token= link) ---
    resetLookup: (token: string) =>
      request<{ valid: boolean; email?: string }>(
        `/auth/native/reset?token=${encodeURIComponent(token)}`,
      ),

    resetConfirm: (token: string, password: string) =>
      request<{ ok: boolean }>("/auth/native/reset/confirm", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      }),
  },

  ask: (question: string) =>
    request<QaAnswer>("/api/qa/ask", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  // The caller org's whole brain as a knowledge graph (nodes + links).
  graph: () => request<BrainGraph>("/api/qa/graph"),

  // Every brain page in full (frontmatter/description/timeline/relationships),
  // for the Pages tab and the graph node-detail panel.
  pages: () => request<{ pages: BrainPage[] }>("/api/qa/pages"),

  // Every captured Google Drive document with its converted Markdown, for the
  // Documents tab (the files the brain can read / has comprehended).
  documents: () => request<{ documents: DocumentFile[] }>("/api/qa/documents"),

  // The caller's Delivery to-do pool (next-24h action items from the brain).
  // `delivery` reads the cached pool; `refreshDelivery` forces a recompute
  // (the Sync-now button).
  delivery: () => request<DeliveryPool>("/api/qa/delivery"),
  refreshDelivery: () =>
    request<DeliveryPool>("/api/qa/delivery/refresh", { method: "POST" }),
  // Mark an item acted-on (by its title) so regeneration stops re-surfacing it.
  dismissDelivery: (key: string) =>
    request<DeliveryPool>("/api/qa/delivery/dismiss", {
      method: "POST",
      body: JSON.stringify({ key }),
    }),
  // Mark a task complete: write a dated, self-reported entry to the brain (so
  // Q&A + future agenda inference see it) AND stop re-surfacing it.
  completeDelivery: (title: string) =>
    request<DeliveryPool>("/api/qa/delivery/complete", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),

  // Ask history: recent questions (list) and one replayed Q&A (detail).
  questions: () =>
    request<{ questions: QaQuestionSummary[] }>("/api/qa/questions"),
  question: (id: number) =>
    request<QaQuestionDetail>(`/api/qa/questions/${id}`),

  // --- Control Tower (platform owner) ---
  ownerLogin: (token: string) =>
    request<{ ok: boolean; role: string }>("/auth/owner-login", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  platform: {
    tenants: () =>
      request<{ tenants: Tenant[] }>("/api/platform/tenants"),

    provision: (
      name: string,
      slug: string,
      admin_email: string,
      region = "EU",
      auth_method: AuthMethod = "entra",
    ) =>
      request<ProvisionResult>("/api/platform/tenants", {
        method: "POST",
        body: JSON.stringify({ name, slug, admin_email, region, auth_method }),
      }),

    // Send a native-auth org its set-up invite(s). Omit `email` to invite every
    // admin (the usual bootstrap right after provisioning). No-op for Entra orgs.
    invite: (slug: string, email?: string) =>
      request<{ ok: boolean; invited: string[]; delivered: boolean }>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/invite`,
        { method: "POST", body: JSON.stringify(email ? { email } : {}) },
      ),

    // The mail link is identical for every customer. The sign-in link carries a
    // "for <slug>" tag so the consent bounce-back can record the customer's
    // tenant id against this workspace automatically.
    consentUrls: (slug: string) =>
      request<ConsentUrls>("/api/platform/consent-urls", {
        method: "POST",
        body: JSON.stringify({ slug }),
      }),

    setSso: (
      slug: string,
      body: {
        tenant_id: string;
        client_id?: string;
        enabled?: boolean;
      },
    ) =>
      request<{ org_id: number; redirect_uri: string; enabled: boolean }>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/sso`,
        { method: "PUT", body: JSON.stringify(body) },
      ),

    verifySso: (slug: string) =>
      request<SsoVerify>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/sso/verify`,
      ),

    members: (slug: string) =>
      request<{ members: Member[] }>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/members`,
      ),

    addMember: (slug: string, email: string, role: string) =>
      request<{ member: Member; members: Member[] }>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/members`,
        { method: "POST", body: JSON.stringify({ email, role }) },
      ),

    // Operator view/edit of a tenant's comprehend Diligence config.
    comprehendSettings: (slug: string) =>
      request<ComprehendSettings>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/comprehend-settings`,
      ),
    updateComprehendSettings: (slug: string, body: Partial<ComprehendSettings>) =>
      request<ComprehendSettings>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/comprehend-settings`,
        { method: "PUT", body: JSON.stringify(body) },
      ),

    // Operator view/edit of a workspace's customer markup factor.
    markup: (slug: string) =>
      request<TenantMarkup>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/markup`,
      ),
    setMarkup: (slug: string, factor: number | null) =>
      request<{ slug: string; factor: number | null; effective: number; default: number }>(
        `/api/platform/tenants/${encodeURIComponent(slug)}/markup`,
        { method: "PUT", body: JSON.stringify({ factor }) },
      ),

    // Operator erasure of any workspace. `confirm` must equal `slug`.
    deleteTenant: (slug: string, confirm: string) =>
      request<WorkspaceErasure>(
        `/api/platform/tenants/${encodeURIComponent(slug)}?confirm=${encodeURIComponent(confirm)}`,
        { method: "DELETE" },
      ),

    connectorStatus: () =>
      request<ConnectorStatus>("/api/platform/connector-status"),

    databases: () =>
      request<{ databases: DbDatabase[] }>("/api/platform/db/databases"),

    tables: (database: string) =>
      request<{ tables: DbTable[] }>(
        `/api/platform/db/tables?database=${encodeURIComponent(database)}`,
      ),

    rows: (
      database: string,
      table: string,
      limit = 50,
      offset = 0,
      opts?: { sort?: string; dir?: "asc" | "desc"; q?: string },
    ) => {
      const p = new URLSearchParams({
        database,
        table,
        limit: String(limit),
        offset: String(offset),
      });
      if (opts?.sort) p.set("sort", opts.sort);
      if (opts?.dir) p.set("dir", opts.dir);
      if (opts?.q) p.set("q", opts.q);
      return request<DbRows>(`/api/platform/db/rows?${p.toString()}`);
    },

    // Relative URL for a CSV/XLSX download of a table (same-origin → the session
    // cookie rides along, so a plain <a download> works). Honours sort/filter.
    dbExportUrl: (
      database: string,
      table: string,
      format: "csv" | "xlsx",
      opts?: { sort?: string; dir?: "asc" | "desc"; q?: string },
    ) => {
      const p = new URLSearchParams({ database, table, format });
      if (opts?.sort) p.set("sort", opts.sort);
      if (opts?.dir) p.set("dir", opts.dir);
      if (opts?.q) p.set("q", opts.q);
      return `/api/platform/db/export?${p.toString()}`;
    },

    usage: (days = 30) =>
      request<{ days: number; rows: PlatformUsageRow[] }>(
        `/api/platform/usage?days=${days}`,
      ),

    usageTimeseries: (days = 30) =>
      request<{ days: number; series: UsageTimeseriesPoint[] }>(
        `/api/platform/usage/timeseries?days=${days}`,
      ),
  },
};

/** Build the Microsoft SSO entry URL for an org slug (same-origin redirect). */
export function ssoLoginUrl(slug: string): string {
  return `/auth/${encodeURIComponent(slug.trim())}/login`;
}
