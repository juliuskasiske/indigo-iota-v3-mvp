/**
 * HTTP Basic Auth gate for the whole site.
 *
 * Cloudflare Pages automatically runs this middleware in front of every
 * request (static asset or otherwise) before serving anything. A visitor
 * must enter the shared username + password — the browser shows a native
 * login prompt — or they get a 401 and see nothing.
 *
 * Configure the credentials as environment variables in the Cloudflare
 * Pages project (Settings → Environment variables):
 *
 *     BASIC_AUTH_USER   e.g. "yc"
 *     BASIC_AUTH_PASS   e.g. a long random string you share with reviewers
 *
 * If either variable is unset (e.g. a local preview), the gate is disabled
 * and everything passes through.
 */

export async function onRequest(context) {
  const { request, next, env } = context;

  const USER = env.BASIC_AUTH_USER;
  const PASS = env.BASIC_AUTH_PASS;

  // No credentials configured → don't gate (local / preview convenience).
  if (!USER || !PASS) {
    return next();
  }

  const header = request.headers.get("Authorization") || "";
  const [scheme, encoded] = header.split(" ");

  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      decoded = "";
    }
    const sep = decoded.indexOf(":");
    if (sep !== -1) {
      const user = decoded.slice(0, sep);
      const pass = decoded.slice(sep + 1);
      if (timingSafeEqual(user, USER) && timingSafeEqual(pass, PASS)) {
        return next();
      }
    }
  }

  return new Response("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Indigo Iota demo", charset="UTF-8"',
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
}

/** Best-effort constant-time string comparison. */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
