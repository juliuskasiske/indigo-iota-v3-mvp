"use client";

import { useState } from "react";
import {
  BookOpen,
  Cloud,
  Building2,
  Users,
  MapPin,
  ChevronRight,
  KeyRound,
  Lock,
  Lightbulb,
  Split,
  Network,
  Terminal,
  Link2,
  Plug,
  Wallet,
  Filter,
  Boxes,
  Rocket,
  ListChecks,
  Server,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Static, read-only runbook for onboarding a new customer end-to-end.
 * Plain language, organised by WHERE each action happens. No data fetching —
 * this is reference material that lives next to the tools it describes.
 *
 * It tracks the CURRENT flow, which is deliberately lopsided:
 *   - The operator (you) does almost nothing per customer: provision a
 *     workspace, send ONE sign-in link, click Verify. The customer's tenant id
 *     is captured automatically when their admin clicks that link — you never
 *     type it. The app credentials live in the server's deploy env (set once),
 *     NOT in this Control Tower.
 *   - The customer's admin does the rest inside their own Admin Center wizard:
 *     Team -> Connect (grant mail access + the Exchange access-policy command)
 *     -> Credits -> Triage (the hard gate) -> Brain -> Activate (the backfill
 *     that builds the brain and finishes setup).
 *
 * The whole thing is long, so every section is a collapsible expander: the page
 * opens short and you expand only the part you need. The "Every piece of info"
 * section is the index for the literal question "what do I need, why, and where
 * does it come from" — for both you and the customer admin.
 */
export function OnboardingGuidePanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs text-accent mb-2">
          Runbook
        </p>
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-accent" />
          Onboarding a new customer
        </h2>
        <p className="text-sm text-foreground-muted mt-1 max-w-2xl">
          Step by step, in plain language. Each step says exactly{" "}
          <strong>where</strong>{" "}it happens — Entra, the server&apos;s
          deploy env, this Control Tower, or the customer&apos;s own Admin
          Center — and every piece of info you or they need says{" "}
          <strong>why</strong>{" "}it matters and{" "}
          <strong>where &amp; when</strong>{" "}it&apos;s found. Expand a section
          to read it.
        </p>
      </div>

      {/* Reference — read once to understand the system, then rarely again. */}
      <Group
        label="Background"
        hint="Read once so the steps make sense. No actions here."
      >
        <Section
          Icon={BookOpen}
          title="First, the words you'll see"
          description="So nothing is mysterious."
          defaultOpen
        >
          <Glossary />
        </Section>

        <Section
          Icon={Lightbulb}
          title="Why any of this exists"
          description="If the Entra steps feel arbitrary, it's because the reasoning is missing. Here it is."
        >
          <BigPicture />
        </Section>

        <Section
          Icon={Lock}
          title="Three gates that sound the same — and aren't"
          description="Three different settings each involve email addresses. They are not the same thing, and none replaces another. This is the single most confused part of the whole system."
        >
          <AccessLayers />
        </Section>
      </Group>

      {/* The actual things you do, in order. */}
      <Group
        label="The steps"
        hint="What happens, in order, and who does each part."
      >
        <Section
          Icon={Cloud}
          title="One-time setup: two apps + the server env"
          badge={<Badge variant="accent">once, ever</Badge>}
          description="Where: the Entra admin center (entra.microsoft.com) signed in with your own Indigo Iota account, then the server's deploy environment. You do this a single time — every future customer reuses the same two apps and the same env."
        >
          <OneTimeSetup />
        </Section>

        <Section
          Icon={Building2}
          title="Per customer — your part (Control Tower)"
          badge={<Badge variant="default">you, ~2 min</Badge>}
          description="Provision the workspace, send one sign-in link, confirm sign-in. That's the whole operator job — everything else is the customer admin's."
        >
          <OperatorFlow />
        </Section>

        <Section
          Icon={Users}
          title="Per customer — the admin's part (Admin Center)"
          badge={<Badge variant="default">customer admin</Badge>}
          description="Six steps the customer's admin walks in their own /admin wizard, in order. You hand this off after sign-in works."
        >
          <CustomerFlow />
        </Section>
      </Group>

      {/* The headline ask: every piece of info, why, and where it comes from. */}
      <Group
        label="Every piece of info"
        hint="What's needed, why, and where & when each piece is found."
      >
        <Section
          Icon={ListChecks}
          title="The info inventory"
          description="Every value you or the customer admin has to find or type — what it's for, and exactly where & when it shows up."
          defaultOpen
        >
          <InfoInventory />
        </Section>
      </Group>

      {/* A one-glance recap of the steps above. */}
      <Group label="Cheat sheet" hint="The whole flow recapped in one table.">
        <Section
          Icon={MapPin}
          title="The whole thing on one page"
          description="Every step in a single table."
        >
          <SummaryTable />
        </Section>
      </Group>
    </div>
  );
}

/** A labelled cluster of sections — separates “read this” from “do this”. */
function Group({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline gap-2 px-1">
        <span className="text-xs text-accent">
          {label}
        </span>
        <span className="text-xs text-foreground-subtle">{hint}</span>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */

/** A collapsible card section. Header is a button with a rotating chevron;
 *  the body renders only when open. Matches the Brain tab's expanders. */
function Section({
  Icon,
  title,
  description,
  badge,
  defaultOpen = false,
  children,
}: {
  Icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  badge?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-5 text-left"
      >
        <ChevronRight
          className={cn(
            "mt-0.5 h-5 w-5 shrink-0 text-foreground-subtle transition-transform",
            open && "rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-base font-semibold leading-tight tracking-tight text-foreground">
            <Icon className="h-4 w-4 shrink-0 text-accent" />
            {title}
            {badge}
          </span>
          {description && (
            <p className="mt-1 text-sm text-foreground-muted">{description}</p>
          )}
        </div>
      </button>
      {open && <div className="border-t border-border/40 p-5">{children}</div>}
    </Card>
  );
}

function Glossary() {
  const terms: { term: string; def: React.ReactNode }[] = [
    { term: "Tenant", def: "One customer company. Each gets its own private database (“brain”) and login URL." },
    {
      term: "Entra",
      def: "Microsoft's identity system (formerly “Azure AD”) — where logins and app permissions live, at entra.microsoft.com.",
    },
    {
      term: "App registration",
      def: "A permission slip Microsoft gives an app. We have two: a Login app (sign-in only, can't read mail) and a Connector app (reads only the mailboxes the customer allows).",
    },
    {
      term: "Admin consent",
      def: "The customer's IT admin clicking “yes, I allow this app.” Only their Global Admin can do this — not you.",
    },
    {
      term: "Exchange / PowerShell",
      def: "The customer's email system, plus a small script their Exchange admin runs to lock the Connector app to specific mailboxes.",
    },
    { term: "Server deploy env", def: "Environment variables on the box that runs Indigo Iota. The app's secrets (SSO_CLIENT_ID, GRAPH_*) live here — never in this Control Tower." },
    { term: "Control Tower (/control)", def: "Your owner-only cockpit. Provision workspaces and wire sign-in. You sign in with the owner passphrase." },
    { term: "Admin Center (/admin)", def: "The customer's own workspace — a six-step setup wizard the first time, their day-to-day dashboard afterwards." },
  ];
  return (
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[12rem_1fr] text-sm">
      {terms.map((t) => (
        <div key={t.term} className="contents">
          <dt className="font-medium text-foreground sm:text-right">
            {t.term}
          </dt>
          <dd className="text-foreground-muted">{t.def}</dd>
        </div>
      ))}
    </dl>
  );
}

function BigPicture() {
  return (
    <div className="space-y-4 text-sm text-foreground-muted [&_strong]:text-foreground">
      <p>
        Indigo Iota needs exactly two things from a customer&apos;s Microsoft
        365: (1) let their staff <strong>sign in</strong>{" "}with the work account
        they already have — no new password — and (2){" "}
        <strong>read a few specific mailboxes</strong>{" "}to build the brain.
      </p>
      <p>
        Microsoft will not let <em>any</em>{" "}program do either of those until
        two conditions are met: the program is{" "}
        <strong>registered as an “app”</strong>{" "}in Microsoft&apos;s identity
        system (Entra), and the customer&apos;s <strong>own IT admin</strong>{" "}
        has explicitly clicked “I allow this app.” That approval gate is the
        whole reason the steps below exist — it&apos;s what stops a random app
        from silently reading a company&apos;s email. You can&apos;t skip it,
        and you can&apos;t do the approval part for the customer.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border/60 p-3">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Split className="h-4 w-4 text-accent" />
            Why two apps, not one
          </p>
          <p className="mt-1.5">
            Signing people in and reading their mail are very different levels
            of risk. We keep them in <strong>separate</strong>{" "}app
            registrations so a problem with one can&apos;t touch the other. The{" "}
            <strong>Login app</strong>{" "}can <em>only</em>{" "}confirm who someone is
            — if its secret ever leaked, no mail is exposed. The{" "}
            <strong>Connector app</strong>{" "}is the only one that can read mail,
            and it&apos;s locked down hard (certificate auth, and caged to
            named mailboxes). One app doing both would mean one leak exposes
            everything.
          </p>
        </div>
        <div className="rounded-lg border border-border/60 p-3">
          <p className="flex items-center gap-2 font-medium text-foreground">
            <Network className="h-4 w-4 text-accent" />
            Why “multi-tenant”, and why only once
          </p>
          <p className="mt-1.5">
            An app registration physically lives in <strong>one</strong>{" "}
            Microsoft directory — yours. “Multi-tenant” is a setting that
            means “customers in <em>other</em>{" "}companies&apos; directories may
            use this app once their admin approves it.” Flip it on and you
            build these two apps <strong>one time</strong>; every future
            customer just consents to the same two. You never get access to,
            or log into, the customer&apos;s Microsoft tenant.
          </p>
        </div>
      </div>
    </div>
  );
}

function AccessLayers() {
  const rows: {
    gate: string;
    where: string;
    controls: string;
    enforcedBy: string;
  }[] = [
    {
      gate: "Members",
      where: "Customer's Admin Center → Team step",
      controls: "Who may sign in and use the workspace",
      enforcedBy: "Indigo Iota",
    },
    {
      gate: "Mail sources",
      where: "Customer's Admin Center → Connect step",
      controls: "Which mailboxes we choose to pull into the brain",
      enforcedBy: "Indigo Iota",
    },
    {
      gate: "Exchange access policy",
      where: "Customer's Exchange (PowerShell from the Connect step)",
      controls: "Which mailboxes the connector is even allowed to read",
      enforcedBy: "Microsoft",
    },
  ];
  return (
    <div className="space-y-4 text-sm">
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-background-soft/40">
            <tr>
              {["Gate", "Where", "What it controls", "Enforced by"].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium text-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.gate}
                className="border-b border-border/40 last:border-0 align-top"
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {r.gate}
                </td>
                <td className="px-3 py-2 text-foreground-muted">{r.where}</td>
                <td className="px-3 py-2 text-foreground-muted">
                  {r.controls}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    variant={r.enforcedBy === "Microsoft" ? "primary" : "default"}
                  >
                    {r.enforcedBy}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 text-foreground-muted [&_strong]:text-foreground">
        <p>
          <strong>Members ≠ mail sources.</strong>{" "}
          The people who log in are
          almost never the mailboxes you ingest. The customer will often pull a{" "}
          <strong>shared mailbox</strong>{" "}like <code>projects@customer.com</code>{" "}
          that nobody logs in as; and they&apos;ll have viewers who log in to{" "}
          <em>ask the brain questions</em>{" "}but whose personal inbox is never
          touched.
        </p>
        <p>
          <strong>
            Mail sources and the access policy are not redundant — that&apos;s
            the whole point.
          </strong>{" "}
          Mail sources is a setting <em>inside our software</em>: a promise
          about which mailboxes we&apos;ll pull. The access policy is enforced
          by <em>Microsoft</em>, outside our reach. The connector&apos;s{" "}
          <code>Mail.Read</code>{" "}permission technically allows the whole
          tenant, so if our code had a bug or our credentials were ever
          misused, the mail-sources setting would stop nothing. The access
          policy is the only thing that makes overreach{" "}
          <strong>physically impossible</strong>{" "}at Microsoft&apos;s side. One
          says “we won&apos;t”; the other says “you can&apos;t.”
        </p>
      </div>

      <div className="rounded-lg border border-border/60 p-3">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Terminal className="h-4 w-4 text-accent" />
          What the “Restrict mailbox access” command actually does
        </p>
        <p className="mt-1.5 text-foreground-muted">
          By default, application <code>Mail.Read</code>{" "}lets the connector
          read <strong>every</strong>{" "}mailbox in the company. The command the
          customer generates in their <strong>Connect</strong>{" "}step fixes that.
          When their Exchange admin runs it:
        </p>
        <ol className="mt-2 ml-4 list-decimal space-y-1 text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
          <li>
            Creates a <strong>mail-enabled security group</strong>{" "}(e.g.{" "}
            <code>iota-scope@customer.com</code>) and puts the allowed
            mailbox(es) in it.
          </li>
          <li>
            Creates a policy tying the <strong>Connector&apos;s client ID</strong>{" "}
            to that group, in <code>RestrictAccess</code>{" "}mode.
          </li>
          <li>
            From then on Microsoft itself returns the connector{" "}
            <code>Granted</code>{" "}for mailboxes in the group and{" "}
            <code>Access Denied</code>{" "}for every other mailbox.
          </li>
          <li>
            A second “test” command prints proof — in-scope shows{" "}
            <code>Granted</code>, an out-of-scope mailbox shows{" "}
            <code>Denied</code>. (Allow a few minutes to propagate.)
          </li>
        </ol>
        <p className="mt-2 text-foreground-muted">
          The customer supplies only one value: the{" "}
          <strong>scope-group address</strong>{" "}(which mailboxes). The{" "}
          <strong>connector&apos;s client id</strong>{" "}(which app to leash) is
          filled in automatically from the server — they never see or paste it.
        </p>
      </div>
    </div>
  );
}

function OneTimeSetup() {
  return (
    <div className="space-y-5 text-sm">
      {/* Shared starting point */}
      <div>
        <p className="font-medium text-foreground">
          Starting point (you&apos;ll do this twice — once per app)
        </p>
        <p className="mt-1 text-foreground-muted">
          In the Entra admin center, this is where new apps get created. Open
          it, then come back and follow the per-app settings below.
        </p>
        <ClickPath
          steps={[
            "entra.microsoft.com",
            "Identity",
            "Applications",
            "App registrations",
            "+ New registration",
          ]}
        />
        <p className="mt-2 text-foreground-muted">
          On the registration screen, give it a name (e.g.{" "}
          <code>Indigo Iota — Login</code>), and for{" "}
          <strong>Supported account types</strong>{" "}pick{" "}
          <strong>
            “Accounts in any organizational directory (multitenant)”
          </strong>
          .
        </p>
        <Why>
          That account-types choice <em>is</em>{" "}the “multi-tenant” switch — it
          lets other companies&apos; admins consent to your app. Pick the
          single-org option by mistake and no customer will be able to use it.
        </Why>
      </div>

      {/* Login app */}
      <div className="rounded-lg border border-border/60 p-4">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <KeyRound className="h-4 w-4 text-accent" />
          App 1 — “Login” (sign-in only)
        </p>
        <p className="mt-1 text-foreground-muted">
          Its entire job is to let the customer&apos;s staff prove who they are.
          It deliberately has <strong>no</strong>{" "}ability to read mail.
        </p>

        <DetailStep action={<>Add two <strong>Redirect URIs</strong>{" "}of type <em>Web</em>: <code>https://YOUR-DOMAIN/auth/callback</code>{" "}and <code>https://YOUR-DOMAIN/auth/consent-callback</code>{" "}(locally <code>http://localhost:8080/…</code>).</>}>
          <Why>
            After someone signs in at Microsoft, Microsoft sends them back to
            your app carrying a one-time proof-of-login code. A Redirect URI is
            the <em>only</em>{" "}web address Microsoft will deliver that to.{" "}
            <code>/auth/callback</code>{" "}catches a normal sign-in;{" "}
            <code>/auth/consent-callback</code>{" "}catches the admin&apos;s consent
            click (this is what auto-captures their tenant id). Both must be
            registered character-for-character, or that step silently fails.
          </Why>
          <ClickPath steps={["the Login app", "Authentication", "+ Add a platform", "Web"]} />
        </DetailStep>

        <DetailStep action={<>Add <strong>delegated</strong>{" "}API permissions: <code>openid</code>, <code>profile</code>, <code>email</code>.</>}>
          <Why>
            “Delegated” means the app only ever acts <em>on behalf of the
            person signing in</em>, never on its own. These three are the
            minimum to confirm identity: <code>openid</code>{" "}= “verify who you
            are,” <code>profile</code>{" "}= their name, <code>email</code>{" "}= their
            email address. There is intentionally no mail permission here — a
            login app should never be able to read mail.
          </Why>
          <ClickPath steps={["the Login app", "API permissions", "+ Add a permission", "Microsoft Graph", "Delegated permissions"]} />
        </DetailStep>

        <DetailStep action={<>Create a <strong>client secret</strong>{" "}and copy it immediately. Note the <strong>Application (client) ID</strong>. Put both in the <strong>server deploy env</strong>: client id as <code>SSO_CLIENT_ID</code>, plus the login secret.</>}>
          <Why>
            A client secret is a password for the <em>app itself</em>: when your
            server finishes a login by talking to Microsoft, it uses this to
            prove “I really am the Login app.” Microsoft shows the value{" "}
            <strong>once</strong>{" "}— copy it now or you must make a new one. Both
            go in the server&apos;s environment (the code reads{" "}
            <code>SSO_CLIENT_ID</code>{" "}to build every sign-in link), <strong>not</strong>{" "}
            into this Control Tower.
          </Why>
          <ClickPath steps={["the Login app", "Certificates & secrets", "+ New client secret"]} />
        </DetailStep>
      </div>

      {/* Connector app */}
      <div className="rounded-lg border border-border/60 p-4">
        <p className="flex items-center gap-2 font-semibold text-foreground">
          <Lock className="h-4 w-4 text-accent" />
          App 2 — “Connector” (reads mail, app-only)
        </p>
        <p className="mt-1 text-foreground-muted">
          This is the one that actually pulls mail to build the brain. It runs
          in the background with nobody logged in, so it&apos;s the riskiest
          piece — and gets the most locks.
        </p>

        <DetailStep action={<>Add the <strong>application</strong>{" "}permission <code>Mail.Read</code>{" "}(note: <em>application</em>, not <em>delegated</em>).</>}>
          <Why>
            Mail ingestion runs on a schedule when no human is signed in, so
            the app must act <em>as itself</em>{" "}— that&apos;s an “application”
            (app-only) permission. Important and a little scary:{" "}
            <strong>
              application <code>Mail.Read</code>{" "}can read every mailbox in
              the tenant by default.
            </strong>{" "}
            That&apos;s exactly why the customer later runs the access-policy
            command (in their Connect step) to cage it to just the project
            mailbox(es).
          </Why>
          <ClickPath steps={["the Connector app", "API permissions", "+ Add a permission", "Microsoft Graph", "Application permissions"]} />
        </DetailStep>

        <DetailStep action={<>Set up a <strong>certificate</strong>{" "}(preferred) or a client secret as its credential.</>}>
          <Why>
            App-only access to mail is high value, so it deserves the stronger
            credential. A certificate is a key pair that can&apos;t be copied
            out of a log the way a password-style secret can. A secret works
            too for a pilot, but a certificate is the recommended choice here.
          </Why>
          <ClickPath steps={["the Connector app", "Certificates & secrets"]} />
        </DetailStep>

        <DetailStep action={<>Put its credentials in the <strong>server deploy env</strong>{" "}as <code>GRAPH_TENANT_ID</code>, <code>GRAPH_CLIENT_ID</code>, <code>GRAPH_CLIENT_SECRET</code>{" "}(or cert paths) — <strong>not</strong>{" "}in this Control Tower.</>}>
          <Why>
            The connector authenticates from the server at the moment it pulls
            mail, so its credentials belong in the server&apos;s environment.
            <code>GRAPH_CLIENT_ID</code>{" "}also auto-fills the access-policy
            command the customer generates. This Control Tower never sees these
            secrets — the “Mail connector credentials” box on the Tenants tab
            only reports whether they&apos;re <em>present</em>, never their
            values.
          </Why>
        </DetailStep>
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent/5 p-3">
        <p className="flex items-center gap-2 font-medium text-foreground">
          <Server className="h-4 w-4 text-accent" />
          The whole point: per customer you need almost nothing
        </p>
        <p className="mt-1.5 text-foreground-muted [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
          Once <code>SSO_CLIENT_ID</code>, the login secret, and the{" "}
          <code>GRAPH_*</code>{" "}values are in the server env, the same two apps
          serve every future customer. You no longer type any client IDs or
          tenant IDs to onboard someone — just a workspace name, a slug, and the
          admin&apos;s email (see the next section).
        </p>
      </div>
    </div>
  );
}

function OperatorFlow() {
  return (
    <div className="space-y-4">
      <Phase
        n={1}
        Icon={Building2}
        title="Provision the workspace"
        where="Control Tower → Tenants tab"
        who="You"
        intro="Creates the customer's private brain. Just three fields:"
        steps={[
          <>
            Open this Control Tower. If prompted, enter the{" "}
            <strong>owner passphrase</strong>{" "}(it&apos;s your only key — the
            owner account has no Microsoft login).
          </>,
          <>
            In the <strong>Tenants</strong>{" "}panel, fill the provision form:
            <ul className="mt-1.5 ml-4 list-disc space-y-1 text-foreground-muted">
              <li>
                <strong>Name</strong>{" "}— the company&apos;s display name (e.g.
                “Acme GmbH”).
              </li>
              <li>
                <strong>Slug</strong>{" "}— a short lowercase handle, letters /
                numbers / hyphens only (e.g. <code>acme</code>). This becomes
                their database name <em>and</em>{" "}their login URL
                (<code>/auth/acme/login</code>), so it&apos;s permanent — choose
                carefully.
              </li>
              <li>
                <strong>First admin email</strong>{" "}— the customer person who
                will run their own setup. They become the workspace&apos;s first
                admin automatically, so they can sign in and start the wizard.
              </li>
            </ul>
          </>,
          <>
            Submit. Safe to re-run — the same slug won&apos;t create a
            duplicate.
          </>,
        ]}
      />

      <Phase
        n={2}
        Icon={KeyRound}
        title="Send the customer the sign-in link"
        where="Control Tower → expand the tenant card → Step 1"
        who="You"
        intro="One link, no inputs — it's the same for every customer (built from the shared Login app)."
        steps={[
          <>
            Expand the customer&apos;s row. <strong>Step 1</strong>{" "}shows the{" "}
            <strong>Sign-in (SSO)</strong>{" "}link. Copy it, or hit Open to test.
          </>,
          <>
            Send it to the customer&apos;s Microsoft admin — they must be a{" "}
            <strong>Global / Privileged Role admin</strong>. They click{" "}
            <strong>Accept</strong>{" "}once. That single click does two things: it
            enables staff sign-in, <em>and</em>{" "}it tells us their directory
            (tenant) id.
          </>,
          <>
            Nothing to type here. Whoever signs in determines which tenant the
            consent lands in — the link doesn&apos;t need to know the tenant in
            advance.
          </>,
        ]}
      />

      <Phase
        n={3}
        Icon={Link2}
        title="Confirm sign-in (SSO)"
        where="Control Tower → same tenant card → Step 2"
        who="You"
        intro="The one per-customer value — their tenant id — arrives on its own."
        steps={[
          <>
            When their admin clicks the link, <strong>Step 2</strong>{" "}fills in
            their <strong>tenant id</strong>{" "}and turns sign-in on. Refresh the
            card to see it land.
          </>,
          <>
            Click <strong>Verify connection</strong>{" "}— it checks Microsoft is
            reachable for that tenant and that the redirect host matches this
            deployment. On success it shows the customer&apos;s login URL.
          </>,
          <>
            <strong>Fallback:</strong>{" "}if the customer emailed you their tenant
            id instead of clicking, open “Enter the tenant id manually” and
            save it.
          </>,
          <>
            That&apos;s the entire operator job. Everything below is the
            customer admin&apos;s, in their own Admin Center — hand it off.
          </>,
        ]}
      />
    </div>
  );
}

function CustomerFlow() {
  return (
    <div className="space-y-4">
      <Phase
        n={1}
        Icon={Users}
        title="Team — invite people"
        where="Admin Center (/admin) → Team"
        who="Customer admin"
        intro="Add everyone who should sign in, each with a role:"
        steps={[
          <>
            <strong>consultant</strong>{" "}(default) — normal working user.
          </>,
          <>
            <strong>admin</strong>{" "}— can run setup and manage members.
          </>,
          <>
            <strong>viewer</strong>{" "}— read-only; asks the brain questions but
            changes nothing.
          </>,
          <>
            The person you named at provisioning is already an admin, so they
            can do every step here.
          </>,
        ]}
      />

      <Phase
        n={2}
        Icon={Plug}
        title="Connect — grant access & pick mailboxes"
        where="Admin Center (/admin) → Connect"
        who="Customer admin (+ a Global Admin & an Exchange admin)"
        intro="This comes before everything else: nothing syncs until mail access is granted. In order:"
        steps={[
          <>
            <strong>Grant mail access.</strong>{" "}A Microsoft{" "}
            <strong>Global Admin</strong>{" "}opens the “Grant mail access” link and
            clicks Accept. This lets the connector read mail (broad for now,
            caged in the last step).
          </>,
          <>
            <strong>Add the mailboxes</strong>{" "}to pull — often a shared mailbox
            like <code>projects@company.com</code>, not a person&apos;s inbox.
          </>,
          <>
            <strong>Name an access-policy group</strong>{" "}(e.g.{" "}
            <code>iota-scope@company.com</code>) and click{" "}
            <strong>Generate access command</strong>.
          </>,
          <>
            An <strong>Exchange admin</strong>{" "}runs the generated PowerShell in
            Exchange Online: it creates the group, adds the mailboxes, and binds
            the connector so Microsoft only ever lets it read those mailboxes.
            Run the test command (in-scope = <code>Granted</code>, others ={" "}
            <code>Denied</code>), then use <strong>Check access</strong>{" "}to
            confirm each inbox is readable.
          </>,
        ]}
      />

      <Phase
        n={3}
        Icon={Wallet}
        title="Credits — fund the workspace"
        where="Admin Center (/admin) → Credits"
        who="Customer admin"
        intro="Set the spending ceiling."
        steps={[
          <>
            Set the starting credit balance. <strong>1 credit = $1</strong>.
          </>,
          <>
            This is the cap Indigo Iota will spend until it&apos;s topped up —
            work pauses at zero.
          </>,
        ]}
      />

      <Phase
        n={4}
        Icon={Filter}
        title="Triage — review & approve the scope"
        where="Admin Center (/admin) → Triage"
        who="Customer admin"
        intro="The one hard gate in the whole flow."
        steps={[
          <>
            Review the scope categories and example snippets — what gets kept
            vs. ignored.
          </>,
          <>
            Clicking <strong>Next</strong>{" "}saves and <strong>signs off</strong>{" "}
            the scope. Capture stays paused until this approval — no mail is
            pulled through an unreviewed gate.
          </>,
        ]}
      />

      <Phase
        n={5}
        Icon={Boxes}
        title="Brain — shape it"
        where="Admin Center (/admin) → Brain"
        who="Customer admin"
        intro="Tell the brain what kinds of things to track before the first emails land:"
        steps={[
          <>
            <strong>Confirm the ontology</strong>{" "}— the entity types the brain
            tracks (people, companies, projects, …).
          </>,
          <>
            <strong>Seed entities</strong>{" "}— an optional starting set of known
            people / companies / projects to anchor it.
          </>,
        ]}
      />

      <Phase
        n={6}
        Icon={Rocket}
        title="Activate — build the brain"
        where="Admin Center (/admin) → Activate"
        who="Customer admin"
        intro="The final step. One button builds the brain and finishes setup."
        steps={[
          <>
            Tick the mailboxes to pull, and set each one&apos;s{" "}
            <strong>since date</strong>{" "}and <strong>max-email cap</strong>. An
            up-front quote shows the most the run could cost.
          </>,
          <>
            The single button pulls that window of history — which{" "}
            <strong>builds the brain</strong>{" "}— and the moment the brain has
            content, setup auto-finishes and the Admin Center opens. There&apos;s
            no separate “Finish”.
          </>,
        ]}
      />
    </div>
  );
}

function InfoInventory() {
  const operatorRows: { info: string; why: string; where: string }[] = [
    {
      info: "Owner passphrase",
      why: "Your only key into this Control Tower — the owner has no Microsoft login.",
      where: "Set on the server as PLATFORM_OWNER_TOKEN (deploy env). You type it at /control when you open it.",
    },
    {
      info: "Workspace name",
      why: "The customer's display label across the product.",
      where: "From your sales contact. You type it in the Provision form (Tenants tab).",
    },
    {
      info: "Slug",
      why: "Becomes the customer's database name AND login URL (/auth/<slug>/login). Permanent.",
      where: "You choose it (short, lowercase, hyphens). Typed in the Provision form.",
    },
    {
      info: "First admin email",
      why: "Seeds the first person who can sign in and run the customer's own setup. Without it nobody can start.",
      where: "Ask the customer who'll run setup. Typed in the Provision form; they become the first admin automatically.",
    },
    {
      info: "Sign-in (consent) link",
      why: "The customer's Microsoft admin clicks it to allow staff sign-in; the click also hands us their tenant id.",
      where: "Generated for you in the expanded tenant card, Step 1. Same link for every customer.",
    },
    {
      info: "Customer's Directory (tenant) id",
      why: "Pins sign-in to exactly that Microsoft directory.",
      where: "You don't type it — captured automatically when their admin clicks the sign-in link (shown in Step 2). Manual box only if they sent it directly.",
    },
  ];

  const envRows: { info: string; why: string; where: string }[] = [
    {
      info: "SSO_CLIENT_ID",
      why: "The Login app's id; the server builds every sign-in and consent link from it.",
      where: "Entra → Login app → Overview (Application (client) ID). Set in the server deploy env once.",
    },
    {
      info: "Login app client secret",
      why: "Lets the server prove it's really the Login app when it completes a sign-in.",
      where: "Entra → Login app → Certificates & secrets (shown once at creation). Set in server env once.",
    },
    {
      info: "GRAPH_TENANT_ID / GRAPH_CLIENT_ID / GRAPH_CLIENT_SECRET (or cert paths)",
      why: "The Connector app's credentials — used to read mail. GRAPH_CLIENT_ID also auto-fills the customer's access-policy command.",
      where: "Entra → Connector app. Set in server env once; never in this Control Tower (Tenants tab only shows present/absent).",
    },
    {
      info: "APP_BASE_URL",
      why: "Base address for every generated link and redirect URI.",
      where: "Server deploy env (defaults to http://localhost:3000 in dev). Set once.",
    },
  ];

  const adminRows: { info: string; why: string; where: string }[] = [
    {
      info: "Team members' emails + roles",
      why: "Decides who can sign in (consultant / admin / viewer).",
      where: "The admin knows their own people. Entered in the wizard's Team step.",
    },
    {
      info: "Mail-access consent link",
      why: "A Microsoft Global Admin clicks it once to let the connector read mail — nothing syncs until then.",
      where: "Shown in the Connect step (“Grant mail access”). Same for every customer.",
    },
    {
      info: "Mailbox addresses to pull",
      why: "The actual inboxes fed into the brain — often a shared mailbox, not a person.",
      where: "The admin chooses them. Added in the Connect step.",
    },
    {
      info: "Scope-group address",
      why: "Names the mail-enabled security group the access policy binds the connector to.",
      where: "The admin picks it (e.g. iota-scope@company.com). Typed in the Connect step; created if it doesn't exist.",
    },
    {
      info: "Access-policy PowerShell + test command",
      why: "Cages the connector so Microsoft itself only lets it read the named mailboxes — the hard guardrail.",
      where: "Generated in the Connect step from the mailboxes + scope group. An Exchange admin runs it in Exchange Online PowerShell.",
    },
    {
      info: "Credit budget",
      why: "The spending ceiling (1 credit = $1); work pauses at zero.",
      where: "Set in the Credits step.",
    },
    {
      info: "Triage scope sign-off",
      why: "The hard gate — no mail is pulled until the admin approves which emails are kept.",
      where: "Triage step; clicking Next approves it.",
    },
    {
      info: "Ontology + seed entities",
      why: "The entity types the brain tracks, plus a starting set of known people / companies.",
      where: "Brain step.",
    },
    {
      info: "Backfill window (since + max per mailbox)",
      why: "How much history to pull on the first build; bounds the cost.",
      where: "Activate step; the final button runs it, builds the brain, and finishes setup.",
    },
  ];

  return (
    <div className="space-y-6 text-sm">
      <InfoTable
        Icon={Building2}
        caption="What you (the operator) need, per customer"
        rows={operatorRows}
      />
      <InfoTable
        Icon={Server}
        caption="What you set ONCE in the server's deploy env"
        rows={envRows}
      />
      <InfoTable
        Icon={Users}
        caption="What the customer admin needs, in their own wizard"
        rows={adminRows}
      />
    </div>
  );
}

function InfoTable({
  Icon,
  caption,
  rows,
}: {
  Icon: LucideIcon;
  caption: string;
  rows: { info: string; why: string; where: string }[];
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 font-medium text-foreground">
        <Icon className="h-4 w-4 text-accent" />
        {caption}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-background-soft/40">
            <tr>
              {["Info", "Why it's needed", "Where & when to find it"].map((h) => (
                <th
                  key={h}
                  className="whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium text-foreground"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.info}
                className="border-b border-border/40 last:border-0 align-top"
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  <code className="rounded bg-background-soft/60 px-1 py-0.5 font-mono text-[11px] text-foreground">
                    {r.info}
                  </code>
                </td>
                <td className="px-3 py-2 text-foreground-muted">{r.why}</td>
                <td className="px-3 py-2 text-foreground-muted">{r.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A muted, accent-labelled “why this matters” note. */
function Why({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[13px] leading-relaxed text-foreground-subtle [&_strong]:text-foreground [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
      <span className="font-semibold text-accent">Why:&nbsp;</span>
      {children}
    </p>
  );
}

/** A breadcrumb showing exactly where to click in a portal. */
function ClickPath({ steps }: { steps: string[] }) {
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1 text-[12px] text-foreground-subtle">
      <span className="mr-0.5 font-medium">Where</span>
      {steps.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 opacity-50" />}
          <code className="rounded bg-background-soft/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {s}
          </code>
        </span>
      ))}
    </p>
  );
}

/** One numbered-feeling action with its reasoning + click path underneath. */
function DetailStep({
  action,
  children,
}: {
  action: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mt-3 border-t border-border/40 pt-3 first:mt-3">
      <p className="flex gap-2 text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>{action}</span>
      </p>
      <div className="pl-6">{children}</div>
    </div>
  );
}

function Phase({
  n,
  Icon,
  title,
  where,
  who,
  intro,
  steps,
}: {
  n: number;
  Icon: LucideIcon;
  title: string;
  where: string;
  who: string;
  intro?: React.ReactNode;
  steps: React.ReactNode[];
}) {
  return (
    <Card>
      <div className="flex flex-col gap-1.5 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
            {n}
          </span>
          <div className="min-w-0">
            <span className="text-base font-semibold leading-tight tracking-tight text-foreground flex items-center gap-2">
              <Icon className="h-4 w-4 text-accent shrink-0" />
              {title}
            </span>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
              <Badge variant="accent">
                <MapPin className="h-3 w-3" />
                {where}
              </Badge>
              <Badge variant="default">{who}</Badge>
            </div>
          </div>
        </div>
      </div>
      <div className="p-5 pt-0 text-sm">
        {intro && <p className="mb-3 text-foreground-muted">{intro}</p>}
        <ol className="space-y-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-0.5 shrink-0 font-mono text-xs text-foreground-subtle">
                {i + 1}.
              </span>
              <span className="text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
                {s}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

function SummaryTable() {
  const rows: [string, string, string, string][] = [
    ["0", "Entra + server env", "You (once ever)", "Create Login + Connector apps; put their ids/secrets in the server's deploy env"],
    ["1", "/control → Tenants", "You", "Provision the workspace: name, slug, first admin email"],
    ["2", "/control → tenant card, Step 1", "You", "Send the customer the one sign-in link (no inputs)"],
    ["3", "/control → tenant card, Step 2", "You / auto", "Tenant id auto-captures when their admin clicks; click Verify"],
    ["4", "/admin → Team", "Customer admin", "Invite the team (email + role)"],
    ["5", "/admin → Connect", "Customer admin", "Global Admin grants mail access; add mailboxes; run the access-policy PowerShell"],
    ["6", "/admin → Credits", "Customer admin", "Set the credit budget (1 credit = $1)"],
    ["7", "/admin → Triage", "Customer admin", "Review & approve the scope (the hard gate)"],
    ["8", "/admin → Brain", "Customer admin", "Confirm ontology + seed entities"],
    ["9", "/admin → Activate", "Customer admin", "Run the backfill — builds the brain & finishes setup"],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-background-soft/40">
          <tr>
            {["#", "Where", "Who", "What"].map((h) => (
              <th
                key={h}
                className="whitespace-nowrap border-b border-border/60 px-3 py-2 font-medium text-foreground"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r[0]}
              className="border-b border-border/40 last:border-0 hover:bg-background-soft/30"
            >
              <td className="px-3 py-2 font-mono text-foreground-subtle">
                {r[0]}
              </td>
              <td className="px-3 py-2 font-mono text-foreground">{r[1]}</td>
              <td className="px-3 py-2 text-foreground-muted">{r[2]}</td>
              <td className="px-3 py-2 text-foreground-muted">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
