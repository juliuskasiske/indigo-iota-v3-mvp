# Deploying Indigo Iota to Cloudflare Pages

The demo is a **fully static site** (no server, no database — created projects
live in the browser's `localStorage`). It's password-protected by a small
Cloudflare Pages Function doing HTTP Basic Auth, so anyone you give the
shared username + password to can see it, and no one else.

This guide gets it live on a subdomain like `demo.yoursite.com`.

---

## What gets deployed

| Piece | What it is |
|---|---|
| `out/` | The static site, produced by `npm run build` (we set `output: "export"` in `next.config.ts`). |
| `functions/_middleware.js` | Runs on Cloudflare in front of every request and enforces Basic Auth. Cloudflare Pages auto-detects the `functions/` folder. |
| `.nvmrc` | Pins Node 20 for the Cloudflare build. |

There is **no backend**. "State" (the projects a viewer creates) is saved in
their browser via `localStorage`, so it survives refreshes and tab-closes on
that browser. It is not shared across devices or people — which is exactly
what we want for a gated single-viewer demo.

---

## Option A — Git integration (recommended)

Cloudflare rebuilds automatically every time you push.

### 1. Push this repo to GitHub (or GitLab)

```bash
git remote add origin git@github.com:youraccount/indigo-iota-demo.git
git push -u origin main
```

### 2. Create the Pages project

In the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
**Connect to Git** → pick the repo.

Set the build configuration:

| Field | Value |
|---|---|
| Framework preset | **Next.js (Static HTML Export)** — or "None" |
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | `/` (leave default) |

### 3. Add the password (environment variables)

Still in the create flow (or later under **Settings → Environment variables**),
add two **production** variables:

| Variable | Example value |
|---|---|
| `BASIC_AUTH_USER` | `yc` |
| `BASIC_AUTH_PASS` | a long random string, e.g. `iota-demo-7Qx2pL9vKtR` |

These are read by `functions/_middleware.js`. If either is missing, the gate
is disabled (handy for a quick public preview, but **set both for the real
deploy**).

> Tip: also set `NODE_VERSION = 20` as an environment variable if the build
> ever complains about the Node version — the `.nvmrc` should handle it, but
> the env var is a belt-and-suspenders.

### 4. Deploy

Click **Save and Deploy**. First build takes ~2 minutes. You'll get a URL
like `indigo-iota-demo.pages.dev`. Visiting it now prompts for the username +
password.

### 5. Point your subdomain at it

Pages project → **Custom domains** → **Set up a custom domain** → enter
`demo.yoursite.com`. If `yoursite.com`'s DNS is managed by Cloudflare,
Cloudflare creates the CNAME for you automatically and provisions the TLS
cert. Within a minute or two `https://demo.yoursite.com` is live and gated.

---

## Option B — Direct upload with Wrangler

No Git connection; you push builds from your machine.

```bash
npm install -g wrangler        # one-time
npm run build                  # produces out/

# First deploy creates the project:
wrangler pages deploy out --project-name indigo-iota-demo
```

Run this from the project root so Wrangler also picks up the `functions/`
folder. Then set the auth vars once:

```bash
wrangler pages secret put BASIC_AUTH_USER --project-name indigo-iota-demo
wrangler pages secret put BASIC_AUTH_PASS --project-name indigo-iota-demo
```

Add the custom subdomain in the dashboard as in step 5 above.

---

## Changing the password

Update `BASIC_AUTH_PASS` (and/or `BASIC_AUTH_USER`) under **Settings →
Environment variables**, then redeploy (Git push, "Retry deployment", or
`wrangler pages deploy out`). No code change needed.

---

## How the auth behaves

- The browser shows a native login dialog on first visit and remembers the
  credentials for the session — reviewers enter them once.
- It gates **everything**, including assets — nothing is visible without the
  password.
- It's enforced at Cloudflare's edge, so it can't be bypassed by poking at
  the JavaScript bundle (unlike a client-side password check).

## Local development

`npm run dev` runs the normal Next dev server with **no** auth gate (the
middleware only runs on Cloudflare / `wrangler pages dev`). To test the gate
locally:

```bash
npm run build
npx wrangler pages dev out
# then set BASIC_AUTH_USER / BASIC_AUTH_PASS in a .dev.vars file
```

## Resetting a viewer's demo state

Created projects live in `localStorage` under the key
`iota.customProjects.v1`. To start fresh: open DevTools → Application →
Local Storage → delete that key (or just use a private window).
