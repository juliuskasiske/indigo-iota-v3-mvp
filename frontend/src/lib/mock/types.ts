export type EntityType =
  | "person"
  | "company"
  | "workstream"
  | "deliverable"
  | "milestone"
  | "objective"
  | "decision"
  | "risk"
  | "task";

export interface Person {
  id: string;
  name: string;
  role: string;
  email: string;
  company: string;
  isPartner?: boolean;
  isClient?: boolean;
  /** Whether this person's email / Slack / files are in sync with the project brain. */
  synced?: boolean;
  joinedAt?: string;
}

export interface Company {
  id: string;
  name: string;
  description: string;
  industry: string;
  /** Optional logo style for client companies the manager just created.
   *  Existing seeded clients map by id; new ones store the variant
   *  directly. */
  logoVariant?:
    | "lattice"
    | "peak"
    | "compass"
    | "hex"
    | "wave"
    | "spark";
}

export interface Workstream {
  id: string;
  name: string;
  description: string;
  owner: string; // person id
  status: "on-track" | "at-risk" | "blocked" | "completed";
  progress: number; // 0-100
  nextMilestone?: string;
  dueDate?: string;
}

export type DeliverableStatus = "todo" | "in-progress" | "in-review" | "done";

/**
 * A deliverable is a defined output of a workstream — usually a memo, model,
 * teardown, or final deck. Differs from a Task (which is a small todo) and
 * from a Milestone (which is a date-bound event). Has a scope description
 * that the manager curates so the team always knows what's in/out of scope.
 */
export interface Deliverable {
  id: string;
  title: string;
  description: string; // editable scope description
  workstreamId: string;
  ownerId: string; // person id — usually the workstream owner
  status: DeliverableStatus;
  /** ISO. When the deliverable came into being / planned work-start.
   *  Drives the left edge of its Gantt bar. */
  createdAt: string;
  /** ISO. Hard deadline — drives the right edge of the Gantt bar. */
  dueDate: string;
  /** True if signals in the knowledge graph suggest this is behind
   *  (related risk surfaced, blocked dependency, deadline drift). Drives
   *  the yellow bar color on the Gantt. */
  atRisk?: boolean;
}

export type TaskStatus = "proposed" | "todo" | "in-progress" | "blocked" | "done";
export type TaskPriority = "high" | "medium" | "low";

/**
 * A task is a small todo with a clear owner. Always linked to a person,
 * optionally to a workstream and/or a deliverable. The Iota Morning Check-in
 * proposes tasks for the manager to approve / edit each day.
 */
export interface Task {
  id: string;
  title: string;
  description?: string;
  assigneeId: string; // person id (required)
  workstreamId?: string; // optional
  deliverableId?: string; // optional — links a task to a specific deliverable
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string; // ISO
  dueAt?: string; // ISO — when this should be done
  proposedBy?: "iota" | string; // "iota" for AI-proposed, or person id
  acceptedAt?: string; // ISO — when manager accepted
  completedAt?: string; // ISO
}

export interface ActivityItem {
  id: string;
  type: "email" | "decision" | "deliverable" | "risk" | "milestone";
  title: string;
  summary: string;
  source: string; // email subject or document
  workstreamId?: string;
  participants: string[]; // person ids
  date: string; // ISO
}

/**
 * What Iota proposes to the manager each morning. Yesterday's recap +
 * per-team-member task lists the manager can edit before sending.
 */
export interface DailyCheckIn {
  id: string;
  date: string; // ISO — the date this check-in is for (today)
  yesterdaySummary: string; // markdown-friendly recap of yesterday
  yesterdayHighlights: Array<{
    label: string;
    detail: string;
    type: "decision" | "deliverable" | "risk" | "milestone" | "request";
  }>;
  proposals: Array<{
    personId: string;
    rationale: string; // why these tasks for this person today
    proposedTaskIds: string[]; // ids referencing tasks in project.tasks
  }>;
  status: "draft" | "sent";
  sentAt?: string;
}

export interface Project {
  id: string;
  name: string;
  client: string; // company name
  clientCompany: Company;
  status: "active" | "planning" | "closing" | "draft";
  description: string;
  context: string;
  startDate: string;
  endDate: string;
  weekNumber: number; // current week in engagement
  totalWeeks: number;
  workstreams: Workstream[];
  team: Person[];
  partners: Person[];
  /** Key contacts on the client side (their VP, CFO, etc.). Drives KG
   *  "client contact" nodes. Empty for projects that haven't surfaced any
   *  contacts yet — they'll get populated automatically from emails. */
  clientContacts: Person[];
  recentActivity: ActivityItem[];
  deliverables: Deliverable[];
  tasks: Task[];
  todaysCheckIn?: DailyCheckIn;
  // Source counts — what Iota has read into the project brain so far.
  emailsScanned: number;
  filesScanned: number;
  slackMessagesScanned: number;
  brainPages: number;
  // Where the brain reaches.
  slackChannels: string[];
  sharepointPath?: string;
  lastSync: string; // ISO
}

export interface GraphNode {
  id: string;
  label: string;
  type: EntityType;
  group: string;
  description?: string;
  // Brain-page path for this entity (Ask-page brain caller only); lets a
  // clicked node open its full page. Absent for the projects-demo graph.
  page_path?: string;
  val?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  label?: string;
  type?:
    | "owns"
    | "reports-to"
    | "involves"
    | "produces"
    | "depends-on"
    | "client"
    | "works-on"
    | "assigned-to"
    | "delivers";
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  links: GraphLink[];
}
