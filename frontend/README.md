# Indigo *Iota* — frontend demo

A clickable demo of **Indigo *Iota***, the project brain for consultancies.

Indigo Iota auto-maintains a project knowledge graph from your team's email,
Slack, and shared files so consultants stop spending their week aligning.
This demo is the *user-facing* side of the product — the flows that turn the
knowledge graph into something a consultancy actually buys.

## What's in the demo

A fictional engagement is fully populated end-to-end:

- **Meridian Strategy Partners** (the demo user is engagement manager *Maya Chen*)
- **Lattice Pay** — US B2B payments fintech entering Europe
- 4 workstreams · 5 consultants · 2 partners · 3 client contacts
- 16 deliverables across the four workstreams
- 15 tasks (most "Iota-proposed" for today's morning check-in)
- A realistic activity feed of decisions, risks, and milestones — each
  attributed to the email or document it came from

## Key flows

### 1. Initialize project — `/projects/new`
Multi-step form with an animated "wiring up" sequence: connecting inboxes,
backfilling 14 days, filtering, detecting entities, building brain pages.
Entities stream into a side panel live.

### 2. Morning check-in — `/projects/[id]/check-in`
Iota's daily standup-in-a-box. Reads yesterday's project activity, recaps
it for the manager, and proposes a focused todo list per team member.
Manager edits inline (title, description, priority, add/remove tasks)
and sends to the team in one click. Triggered by a dismissible banner
on the project page.

### 3. Partner briefing — Team tab → *Send partner briefing*
Partner-targeted briefing flow: question + date range → streamed markdown
brief with source attribution. Opens in a dialog from the partner's row
in the Team tab.

### 4. Team onboarding — Team tab → *Onboard team member*
Pick a workstream + new hire, generate a tailored onboarding brief, then
"send & subscribe inbox" — Iota would OAuth into the new hire's inbox and
start scanning.

### 5. Knowledge Graph — last tab on the project page
3D Three.js force-directed view of the entire project brain. Type filters
(checkboxes), entity search with autocomplete + camera fly, focus mode that
highlights a selected node's 1-hop neighborhood and dims the rest.

## Project page tab structure

```
Overview → Team → Workstreams → Deliverables → Knowledge Graph
```

- **Overview** — workstream cards, team sidebar, recent activity timeline.
- **Team** — consultant list (with *Remove from monitoring* per person),
  partner list (with *Send partner briefing* per partner), and an *Onboard
  team member* CTA.
- **Workstreams** — sub-tabs per workstream; each shows upcoming deliverables
  with inline-editable deadlines, followed by a reverse-chronological
  activity history.
- **Deliverables** — all 16 deliverables grouped by workstream, every scope
  description editable inline ("Save & notify team"). An "edited" marker
  shows when the manager has changed something.
- **Knowledge Graph** — see above.

## Running it

```bash
npm install      # one-time
npm run dev      # http://localhost:3000
```

That's it. All data is mocked; nothing external is called.

## What's mocked

Everything backend-y. There's no real LLM, no real email integration, no real
graph database. The briefing, onboarding, and check-in outputs are canned-
but-realistic markdown that streams token-by-token to feel live. The entity
stream during project initialization is a scripted reveal. The 3D graph is
built from the same in-memory mock data.

The real backend lives in the sibling project (`../test_1`) — see its
`HANDOVER.md` for the actual implementation.

## Stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS v4 (CSS-based config in `src/app/globals.css`)
- shadcn-style UI primitives built on Radix (`src/components/ui/`)
- `react-force-graph-3d` + Three.js for the knowledge graph
- `react-markdown` + `remark-gfm` for streaming markdown output

## File layout

```
src/
├── app/
│   ├── page.tsx                              dashboard landing
│   ├── projects/
│   │   ├── page.tsx                          all projects list
│   │   ├── new/page.tsx                      initialize project flow
│   │   └── [projectId]/
│   │       ├── page.tsx                      project detail (tabs)
│   │       └── check-in/page.tsx             morning check-in
│   └── settings/page.tsx                     workspace settings
├── components/
│   ├── app-shell.tsx                         sidebar + header
│   ├── iota-logo.tsx                         brand mark (italic ι)
│   ├── initialize-project-flow.tsx           init form + animation
│   ├── morning-check-in.tsx                  daily check-in view
│   ├── knowledge-graph-3d.tsx                Three.js graph
│   ├── project-view.tsx                      project detail wrapper
│   ├── project-tabs/                         the 5 project tabs
│   │   ├── overview-tab.tsx
│   │   ├── team-tab.tsx
│   │   ├── workstream-tab.tsx
│   │   ├── deliverable-tab.tsx
│   │   └── graph-tab.tsx
│   ├── panels/                               reusable in-dialog flows
│   │   ├── partner-briefing-panel.tsx
│   │   └── team-onboarding-panel.tsx
│   └── ui/                                   shadcn-style primitives
└── lib/
    ├── utils.ts                              cn(), formatters, sleep()
    └── mock/
        ├── types.ts                          model definitions
        └── data.ts                           all demo content
```

## Re-skinning the demo

If you want a different fictional client or industry, edit
`src/lib/mock/data.ts` — that's the single source of truth for every name,
project, workstream, deliverable, task, and check-in content.
