"use client";

import { useState } from "react";
import {
  ShieldCheck,
  ChevronRight,
  Lightbulb,
  Hash,
  PenLine,
  Cookie,
  Lock,
  Cloud,
  Plug,
  Ticket,
  ArrowLeftRight,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Static, read-only explainer: how authentication works across the product, for
 * a reader who has never studied OAuth or security primitives. Written
 * problem-first — each step names the problem it solves so nothing feels
 * arbitrary. Same visual language as the onboarding runbook (collapsible
 * sections, "why" notes, small tables). No data fetching.
 */
export function AuthBasicsPanel() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-mono uppercase tracking-[0.2em] text-accent mb-2">
          Reference
        </p>
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          How authentication works
        </h2>
        <p className="text-sm text-foreground-muted mt-1 max-w-2xl">
          Three sign-in flows look similar but solve different problems: our own
          login, Microsoft SSO, and the new MCP connectors. This explains each
          from first principles —{" "}
          <strong>what problem every step solves</strong>{" "}— assuming no prior
          security knowledge. Expand a section to read it.
        </p>
      </div>

      {/* The primitives everything else is built from. */}
      <Group
        label="Foundations"
        hint="Read once. Three ideas the rest depends on."
      >
        <Section
          Icon={Lightbulb}
          title="The core problem: the web has no memory"
          description="Why a login always produces a token in the first place."
          defaultOpen
        >
          <div className="space-y-3 text-sm text-foreground-muted [&_strong]:text-foreground">
            <p>
              Every web request is independent — the server does not “remember”
              you between clicks. So each request must somehow re-prove who you
              are. You obviously can&apos;t send your password on every request
              (it would end up logged, cached, stolen).
            </p>
            <p>
              So the universal pattern is:{" "}
              <strong>
                prove who you are once, the hard way, then receive a token that
                is easy to present on every later request.
              </strong>{" "}
              Everything below is a variation on two questions: how do you get
              that token, and what does the token let you do?
            </p>
          </div>
        </Section>

        <Section
          Icon={Hash}
          title="Hashing — keeping a secret without storing it"
          description="How we store passwords and tokens that a database leak can't reveal."
        >
          <div className="space-y-3 text-sm text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
            <p>
              A hash is a one-way function: <code>hash(&quot;hunter2&quot;)</code>{" "}
              always gives the same scrambled output, but you can&apos;t run it
              backwards to recover the input. So we never store passwords or
              tokens themselves — we store their hash. At login we hash what was
              typed and compare hashes. If the database leaks, an attacker gets
              hashes, not secrets.
            </p>
            <Why>
              We use <strong>argon2id</strong>{" "}for passwords — a deliberately{" "}
              <em>slow</em>{" "}hash, so guessing billions of candidates is
              expensive — and plain <strong>SHA-256</strong>{" "}for random tokens,
              which are already unguessable and don&apos;t need slowing.
            </Why>
          </div>
        </Section>

        <Section
          Icon={PenLine}
          title="Signing — trusting a token you handed out"
          description="How a token can prove WE issued it, without us storing a copy."
        >
          <div className="space-y-3 text-sm text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
            <p>
              We want a token that, when it comes back, we can trust we issued
              and nobody altered. The trick: take the facts to put inside it
              (your user id, your org, your role, an expiry), and compute a{" "}
              <strong>signature</strong>{" "}= a hash of those facts mixed with a
              secret key only our server knows. Bundle{" "}
              <code>{"{facts}.{signature}"}</code>{" "}together — that is a{" "}
              <strong>JWT</strong>.
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>Anyone holding it can read the facts (so we never put real secrets inside).</li>
              <li>
                Nobody can change a fact or forge a new one — they&apos;d need
                the secret key to produce a matching signature.
              </li>
              <li>
                When it returns, we recompute the signature; if it matches, the
                token is authentic and untampered.
              </li>
            </ul>
            <p>
              This is why our session is <strong>self-contained</strong>: we
              don&apos;t keep a big table of active sessions — the signed token{" "}
              <em>is</em>{" "}the proof. It rides in a cookie named{" "}
              <code>iota_session</code>{" "}(valid 30 days,{" "}
              <code>HttpOnly</code>{" "}so scripts can&apos;t read it,{" "}
              <code>Secure</code>{" "}so it only travels over HTTPS).
            </p>
          </div>
        </Section>
      </Group>

      {/* The three flows. */}
      <Group label="The three flows" hint="Same goal, three different setups.">
        <Section
          Icon={Lock}
          title="1 · Native sign-in — just us and the user"
          badge={<Badge variant="default">email + password + app code</Badge>}
          description="For customers with no Microsoft. We are the sole authority — nobody else is involved."
        >
          <div className="space-y-4 text-sm text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
            <p>
              <strong>Problem 1 — a password alone is weak.</strong>{" "}
              Passwords get reused, phished, guessed, leaked. So we add a{" "}
              <strong>second factor</strong>: something you{" "}
              <em>have</em>{" "}(your phone), not just something you{" "}
              <em>know</em>. That&apos;s <strong>TOTP</strong>{" "}— at setup we and
              your authenticator app share a random seed; from then on both sides
              independently compute the same 6-digit code from{" "}
              <code>seed + current time</code>. The code is never transmitted at
              setup, so knowing the password isn&apos;t enough — an attacker
              would also need your physical device.
            </p>
            <p>
              <strong>Problem 2 — how does the user get a password safely?</strong>{" "}
              Emailing passwords is unsafe. So onboarding is invite-based: an
              admin adds the email; we send a <strong>single-use link</strong>{" "}
              (we store only its hash); clicking it proves they control that
              inbox, then they set their own password and enrol their
              authenticator.
            </p>
            <Steps
              caption="The login itself is two steps — we don't even confirm the password was right until the second factor passes too:"
              rows={[
                <>
                  <code>POST /auth/native/login</code>{" "}with email + password →
                  we hash the password and compare. Correct? We{" "}
                  <strong>don&apos;t</strong>{" "}log you in yet — we issue a
                  short-lived (5-min) <code>iota_mfa</code>{" "}cookie meaning
                  “password ok, MFA pending”. (Too many wrong tries → temporary
                  lockout, so it can&apos;t be brute-forced.)
                </>,
                <>
                  You submit the 6-digit code (carrying that{" "}
                  <code>iota_mfa</code>{" "}cookie) → we compute the expected code
                  from your seed + the clock and compare. Match? <strong>Now</strong>{" "}
                  we issue the real <code>iota_session</code>{" "}JWT cookie.
                </>,
              ]}
            />
            <Mental>
              <strong>We</strong>{" "}check both factors ourselves, then hand out{" "}
              <strong>our</strong>{" "}session cookie.
            </Mental>
          </div>
        </Section>

        <Section
          Icon={Cloud}
          title="2 · Microsoft SSO (Entra) — us, Microsoft, and the user"
          badge={<Badge variant="default">delegated login (OIDC)</Badge>}
          description="For corporate customers whose staff already have Microsoft work accounts. Their IT controls the accounts; we never see the password."
        >
          <div className="space-y-4 text-sm text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
            <p>
              <strong>Problem — we shouldn&apos;t be the one checking the password.</strong>{" "}
              If the customer&apos;s identity lives in Microsoft, Microsoft should
              verify it; we just need Microsoft to <strong>vouch</strong>{" "}for the
              user. That&apos;s <strong>delegated authentication</strong>{" "}(the
              “SSO” idea), and the protocol is <strong>OIDC</strong>{" "}(OpenID
              Connect — OAuth used for login).
            </p>
            <p>
              The roles matter: Microsoft is the <strong>authority</strong>; we
              are the <strong>client</strong>{" "}asking it “is this person who they
              claim, and who are they?”. Remember this — in flow 3 it flips.
            </p>
            <Steps
              caption="Step by step, with the problem each step solves:"
              rows={[
                <>
                  User clicks “Sign in with Microsoft” →{" "}
                  <code>GET /auth/&lt;slug&gt;/login</code>.{" "}
                  <em>Problem:</em>{" "}they&apos;ll leave for Microsoft and come
                  back later — how do we know the returner is the same person and
                  the reply is fresh? <em>Step:</em>{" "}we generate random{" "}
                  <code>state</code>{" "}+ <code>nonce</code>{" "}+ a PKCE secret,
                  stash them in a short-lived signed cookie, and redirect.
                </>,
                <>
                  The user authenticates <strong>with Microsoft</strong>{" "}
                  (password, their own MFA). We never see any of it — the whole
                  point.
                </>,
                <>
                  Microsoft redirects the browser back to{" "}
                  <code>/auth/callback</code>{" "}with a one-time{" "}
                  <strong>code</strong>.
                </>,
                <>
                  Our <strong>server</strong>{" "}exchanges that code directly with
                  Microsoft for an <strong>id_token</strong>{" "}(a JWT, but signed
                  by Microsoft). <em>Problem:</em>{" "}how do we trust a token{" "}
                  <em>Microsoft</em>{" "}signed, with no shared secret? <em>Step:</em>{" "}
                  Microsoft publishes its <strong>public keys</strong>; its
                  signature is asymmetric (signed with Microsoft&apos;s private
                  key, verifiable with the public one). We verify the signature,
                  and check the <code>nonce</code>/<code>state</code>{" "}match what
                  we stashed (proves the reply is for our fresh request).
                </>,
                <>
                  We map Microsoft&apos;s identity to a user + membership (which
                  org, what role) and issue <strong>our own</strong>{" "}
                  <code>iota_session</code>{" "}cookie — the same one a native user
                  gets.
                </>,
              ]}
            />
            <Mental>
              <strong>Microsoft</strong>{" "}checks identity and signs a vouching
              token; <strong>we</strong>{" "}verify Microsoft&apos;s signature, then
              hand out <strong>our</strong>{" "}session cookie. (Revoke the person
              in Microsoft → they can&apos;t get a fresh session.)
            </Mental>
          </div>
        </Section>

        <Section
          Icon={Plug}
          title="3 · MCP connectors — the new OAuth server"
          badge={<Badge variant="accent">OAuth 2.1</Badge>}
          description="Letting Claude / ChatGPT call our API on a user's behalf — without ever giving them the user's password."
        >
          <div className="space-y-4 text-sm text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
            <p>
              In flows 1–2 the thing being authenticated is{" "}
              <strong>a human at a browser on our own site</strong>, and the
              result is a <strong>cookie</strong>{" "}the browser auto-sends. An MCP
              client is different: it&apos;s <strong>Claude or ChatGPT</strong>{" "}
              — separate software, on someone else&apos;s servers, that wants to
              call our API for the user. That breaks the cookie model and raises
              three problems:
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>It&apos;s not a browser on our domain, so it can&apos;t hold a cookie we auto-trust — it needs a credential it deliberately stores and sends.</li>
              <li>
                We must <strong>not</strong>{" "}let the user paste their password
                into Claude — that would be total, permanent, un-revocable access.
              </li>
              <li>Access must be limited and revocable: read-only, one workspace, killable without touching the password.</li>
            </ul>
            <p>
              That is exactly what <strong>OAuth</strong>{" "}was invented for:{" "}
              <strong>
                let a third-party app do a specific, limited thing on my behalf,
                without my password, revocable anytime.
              </strong>{" "}
              And here is the <strong>role flip</strong>: with Entra{" "}
              <em>we</em>{" "}were the client asking Microsoft; with MCP{" "}
              <strong>we are now the authority</strong>{" "}and Claude is the client
              asking us. We play Microsoft&apos;s old role.
            </p>

            <Roles />

            <Steps
              caption="The flow, problem-by-problem:"
              rows={[
                <>
                  <strong>Discovery.</strong>{" "}<em>Problem:</em>{" "}Claude has
                  never met our server — where does it register, send the user,
                  get tokens? <em>Step:</em>{" "}we publish standard{" "}
                  <code>/.well-known/…</code>{" "}metadata it reads. (This is why a
                  connector “just works” from a URL.)
                </>,
                <>
                  <strong>Dynamic Client Registration</strong>{" "}
                  (<code>POST /register</code>). <em>Problem:</em>{" "}we can&apos;t
                  pre-arrange with every Claude/ChatGPT in the world.{" "}
                  <em>Step:</em>{" "}the client registers itself and gets an id.
                </>,
                <>
                  <strong>Authorize</strong>{" "}— browser sent to{" "}
                  <code>/authorize</code>. <em>Problem:</em>{" "}the user must
                  approve, which means knowing who they are — but Claude must
                  stay out of that. <em>Step:</em>{" "}we bounce the{" "}
                  <strong>browser</strong>{" "}to our own consent page and{" "}
                  <strong>reuse the <code>iota_session</code>{" "}cookie</strong>{" "}
                  from flows 1–2 to identify them. OAuth doesn&apos;t replace our
                  login — it sits on top of it.
                </>,
                <>
                  <strong>Consent</strong>{" "}(<code>/mcp/consent</code>).{" "}
                  <em>Problem:</em>{" "}a token must be tied to exactly one
                  workspace, with the user&apos;s explicit agreement.{" "}
                  <em>Step:</em>{" "}we show “Allow [Claude] to read [which
                  workspace?]”, list their workspaces, and{" "}
                  <strong>validate the chosen one is actually theirs</strong>.
                  Approve → we mint a one-time authorization code.
                </>,
                <>
                  <strong>Code → token</strong>{" "}(<code>POST /token</code>).{" "}
                  <em>Problem:</em>{" "}the code travels back through the browser
                  URL, which can leak. <em>Step: PKCE</em>{" "}— before authorizing,
                  Claude invented a random “verifier” and sent us only its hash
                  (“challenge”). At <code>/token</code>{" "}it must present the
                  original verifier; we hash it and check it matches. A thief who
                  grabbed the code from a URL doesn&apos;t have the verifier, so
                  the code is useless. (Codes are single-use and expire in
                  minutes.)
                </>,
                <>
                  <strong>Tokens issued.</strong>{" "}An <strong>access</strong>{" "}
                  token (short, ~1 h) is the key Claude attaches to each call; a{" "}
                  <strong>refresh</strong>{" "}token (long) silently gets a fresh
                  access token without re-bothering the user.{" "}
                  <em>Why split them:</em>{" "}a leaked access token is only
                  dangerous briefly; the powerful long-lived one is used rarely
                  (only at <code>/token</code>), and rotating on refresh revokes
                  the old pair, so a stolen refresh token dies the moment the
                  real one is used.
                </>,
                <>
                  <strong>Using it.</strong>{" "}Claude calls{" "}
                  <code>POST /mcp</code>{" "}with{" "}
                  <code>Authorization: Bearer &lt;token&gt;</code>. We see it&apos;s
                  bound to (this user, this workspace, scope{" "}
                  <code>brain:read</code>) and serve only that workspace&apos;s
                  brain. Revoke anytime → next call is a 401.
                </>,
              ]}
            />
            <Why>
              <strong>Scope</strong>{" "}(<code>brain:read</code>) says exactly{" "}
              <em>what</em>{" "}a token may do, not “everything”. The MCP is{" "}
              <strong>read-only</strong>: its tools return raw context for the
              calling model to reason over, so a connector never spends this
              workspace&apos;s LLM credits. The token carries{" "}
              <code>(user_id, org_id)</code>, so MCP usage is attributed to the
              right member and scoped to this one workspace, read-only.
            </Why>
            <Mental>
              The user, in their browser, tells <strong>us</strong>{" "}“I allow this
              outside program to read this one workspace.” We hand{" "}
              <strong>the program</strong>{" "}a limited, expiring, revocable key —
              never the user&apos;s password, and never our session cookie.
            </Mental>
          </div>
        </Section>
      </Group>

      {/* The contrast that ties it together. */}
      <Group label="Side by side" hint="The two ideas that make it click.">
        <Section
          Icon={ArrowLeftRight}
          title="What's actually different"
          description="One table, then the two sentences worth remembering."
          defaultOpen
        >
          <div className="space-y-4 text-sm">
            <Compare />
            <div className="space-y-3 text-foreground-muted [&_strong]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
              <p className="flex gap-2">
                <Cookie className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>
                  <strong>Cookie vs. Bearer token</strong>{" "}is the deepest split.
                  A <strong>cookie</strong>{" "}is for{" "}
                  <strong>our website talking to a human&apos;s browser</strong>{" "}
                  (the browser sends it automatically). A{" "}
                  <strong>bearer token</strong>{" "}is for{" "}
                  <strong>a program calling our API</strong>{" "}(it attaches the
                  token on purpose). Native and Entra both end in a cookie
                  because both end with a human on our site; MCP ends in a bearer
                  token because the caller is software.
                </span>
              </p>
              <p className="flex gap-2">
                <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                <span>
                  <strong>OAuth is the same dance in two directions.</strong>{" "}
                  With <strong>Entra</strong>{" "}we are the <em>client</em>{" "}
                  delegating <em>to</em>{" "}Microsoft; with <strong>MCP</strong>{" "}
                  we are the <em>authority</em>{" "}Claude delegates <em>to</em>.
                  Once you see that symmetry, both “redirect → code → token,
                  guarded by signatures and PKCE” flows are the same steps with
                  our chair moved to the other side of the table.
                </span>
              </p>
            </div>
          </div>
        </Section>
      </Group>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits (mirrors the onboarding runbook's look).               */

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
        <span className="text-xs font-mono uppercase tracking-[0.2em] text-accent">
          {label}
        </span>
        <span className="text-xs text-foreground-subtle">{hint}</span>
      </div>
      {children}
    </section>
  );
}

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

/** A muted, accent-labelled "why this matters" note. */
function Why({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[13px] leading-relaxed text-foreground-subtle [&_strong]:text-foreground [&_em]:text-foreground-muted [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
      <span className="font-semibold text-accent">Why:&nbsp;</span>
      {children}
    </p>
  );
}

/** The one-line "mental model" takeaway at the end of a flow. */
function Mental({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 text-[13px] leading-relaxed text-foreground-muted [&_strong]:text-foreground [&_em]:text-foreground-muted [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
      <span className="font-semibold text-accent">Mental model:&nbsp;</span>
      {children}
    </div>
  );
}

/** A numbered list of steps with an intro caption. */
function Steps({
  caption,
  rows,
}: {
  caption: React.ReactNode;
  rows: React.ReactNode[];
}) {
  return (
    <div>
      <p className="mb-2 text-foreground-muted [&_strong]:text-foreground">
        {caption}
      </p>
      <ol className="space-y-2.5">
        {rows.map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 font-mono text-[11px] font-semibold text-accent">
              {i + 1}
            </span>
            <span className="text-foreground-muted [&_strong]:text-foreground [&_em]:text-foreground [&_code]:rounded [&_code]:bg-background-soft/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
              {s}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Roles() {
  const rows: [string, string][] = [
    ["Resource Owner", "the human (owns the brain data)"],
    ["Client", "the app wanting access (Claude / ChatGPT)"],
    ["Authorization Server", "issues tokens after the human consents — us, now"],
    ["Resource Server", "holds the data and accepts tokens — also us (the /mcp endpoint)"],
  ];
  return (
    <div className="rounded-lg border border-border/60 p-3">
      <p className="mb-2 font-medium text-foreground">The four OAuth roles</p>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr] text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-medium text-foreground sm:text-right">{k}</dt>
            <dd className="text-foreground-muted">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Compare() {
  const cols = ["", "Native", "Entra (SSO)", "MCP (OAuth)"];
  const rows: string[][] = [
    ["Who is authenticated?", "a human in a browser", "a human in a browser", "a third-party program acting for a human"],
    ["Who checks identity?", "us (password + TOTP)", "Microsoft", "the user's existing session (native or Entra)"],
    ["Our role", "the authority", "the client asking Microsoft", "the authority Claude asks"],
    ["User ends up holding", "iota_session cookie", "iota_session cookie", "nothing new — they just approve"],
    ["Caller presents each request", "cookie (auto-sent)", "cookie (auto-sent)", "Bearer token (attached on purpose)"],
    ["Scope of access", "full session, all their orgs", "full session, all their orgs", "one workspace, read-only, revocable"],
    ["Password shared with caller?", "no (typed into our form)", "no (typed into Microsoft)", "no — that's the entire point"],
  ];
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-background-soft/40">
          <tr>
            {cols.map((h) => (
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
            <tr key={r[0]} className="border-b border-border/40 last:border-0 align-top">
              <td className="px-3 py-2 font-medium text-foreground">{r[0]}</td>
              <td className="px-3 py-2 text-foreground-muted">{r[1]}</td>
              <td className="px-3 py-2 text-foreground-muted">{r[2]}</td>
              <td className="px-3 py-2 text-foreground-muted">{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
