// Sign-in, the callback and sign-out (spec 4.6 "Sign-in note", F2, F3, F10; ADR-002).
//
//   GET  /auth/signin     step 1: an auth_attempts row (state, nonce), the 10-minute state cookie,
//                         and a redirect to {IDENTITY_ORIGIN}/authorize. Sign up and Sign in both
//                         start here; the identity host's page offers both.
//   GET  /auth/callback   step 4: verifyNote() (note.ts), then the account (found or created by
//                         instance, kind 'did' and SCID, seeds copied on first sign-in), a 30-day
//                         session cookie, Referrer-Policy: no-referrer and a redirect to / at once.
//                         Any failure: 401 and no session.
//   POST /auth/signout    clears the session (Origin-checked like every state-changing route).
//
// Sign-in and the callback are rate-limited per address (src/river/rateLimit.ts): 429 and a page.
//
// The note, the state and the cookies are never logged; a refusal logs its reason code only.
import { randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { env } from "../../config/env.js";
import { forInstance } from "../../db/context.js";
import { signInAccount } from "../accounts.js";
import { requireInstance, type Instance } from "../instances.js";
import { limitByIp } from "../rateLimit.js";
import { STATE_COOKIE, STATE_MAX_AGE_S, cookieHeader, readCookie, sign, unsign } from "./cookies.js";
import { DidResolver } from "./did.js";
import { NoteError, verifySignInNote } from "./note.js";
import { clearSessionCookie, nowSeconds, sessionCookie } from "./session.js";

/** The River's callback, as registered with the identity host (RIVER_CLIENT_ORIGINS). */
export const CALLBACK_PATH = "/api/auth/callback";

let resolver: DidResolver | undefined;

/** The process's DID resolver (10-minute cache). */
export function didResolver(): DidResolver {
  resolver ??= new DidResolver({ allowLoopback: env.testDidLoopback });
  return resolver;
}

function opaque(): string {
  return randomBytes(32).toString("base64url");
}

/** The identity host's authorize URL for this attempt (spec 4.6 step 1). */
export function authorizeUrl(state: string, nonce: string): string {
  const origin = env.riverPublicOrigin;
  const url = new URL("/authorize", env.identityOrigin);
  url.search = new URLSearchParams({
    client_id: origin,
    redirect_uri: `${origin}${CALLBACK_PATH}`,
    state,
    nonce,
  }).toString();
  return url.toString();
}

const ESCAPE: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** The page a refused callback shows: no detail, a way back. No script, no inline style (CSP). */
function refusedPage(): string {
  const title = "Sign-in didn't work";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title.replace(/[&<>"]/g, (c) => ESCAPE[c] ?? c)} · Mosaic River</title></head>
<body>
<main>
<h1>${title}</h1>
<p>The sign-in link was used already, expired, or didn't come from this browser. Go back to the River and sign in again.</p>
<p><a href="/">Go to the River</a></p>
</main>
</body>
</html>
`;
}

function refuse(res: Response, reason: string): void {
  console.warn(`River sign-in refused: ${reason}`);
  res.status(401).set("Cache-Control", "no-store").set("Referrer-Policy", "no-referrer").type("html").send(refusedPage());
}

export function authRoutes(): Router {
  const router = Router();

  router.get("/auth/signin", limitByIp("signin"), requireInstance(), async (_req, res, next) => {
    try {
      const instance = res.locals.instance as Instance;
      const state = opaque();
      const nonce = opaque();
      // INSERT only: river_app can't read attempts back except through consume_auth_attempt().
      await forInstance(instance.id, (db) =>
        db.query("INSERT INTO river.auth_attempts (state, nonce) VALUES ($1, $2)", [state, nonce]),
      );
      res
        .status(303)
        .set("Cache-Control", "no-store")
        .set("Referrer-Policy", "no-referrer")
        .append("Set-Cookie", cookieHeader(STATE_COOKIE, sign(env.sessionSecret, "signin-state", state), STATE_MAX_AGE_S))
        .location(authorizeUrl(state, nonce))
        .end();
    } catch (err) {
      next(err);
    }
  });

  router.get("/auth/callback", limitByIp("callback"), requireInstance(), async (req: Request, res: Response) => {
    const instance = res.locals.instance as Instance;
    const cookieState = unsign(env.sessionSecret, "signin-state", readCookie(req.get("cookie"), STATE_COOKIE));
    let consumed = false;
    try {
      const verified = await verifySignInNote(
        { state: req.query.state, note: req.query.note, cookieState },
        {
          consumeAttempt: async (state) => {
            const { rows } = await forInstance(instance.id, (db) =>
              db.query<{ nonce: string | null }>("SELECT river.consume_auth_attempt($1) AS nonce", [state]),
            );
            consumed = true;
            return rows[0]?.nonce ?? undefined;
          },
          resolver: didResolver(),
          audience: env.riverPublicOrigin,
          trustedHosts: env.trustedDidHosts,
          now: nowSeconds,
        },
      );
      const { accountId } = await signInAccount(instance, verified);
      res
        .status(303)
        .set("Cache-Control", "no-store")
        .set("Referrer-Policy", "no-referrer")
        .append("Set-Cookie", cookieHeader(STATE_COOKIE, "", 0))
        .append("Set-Cookie", sessionCookie(instance.id, accountId))
        .location("/")
        .end();
    } catch (err) {
      // The state cookie goes once its attempt is spent; a mismatched one may belong to another tab.
      if (consumed) res.append("Set-Cookie", cookieHeader(STATE_COOKIE, "", 0));
      if (err instanceof NoteError) {
        refuse(res, err.reason);
        return;
      }
      // Anything else (the database, say) still ends with no session: 401, logged without detail.
      console.error(`River sign-in failed: ${err instanceof Error ? err.name : 'error'}`);
      refuse(res, 'error');
    }
  });

  router.post("/auth/signout", (_req, res) => {
    res.status(204).set("Cache-Control", "no-store").append("Set-Cookie", clearSessionCookie()).end();
  });

  return router;
}
