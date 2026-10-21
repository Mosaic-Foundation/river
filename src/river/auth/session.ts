// Sessions (spec 4.6, Appendix B): a signed, stateless cookie (cookies.ts) naming the instance and
// the account, checked on every request against the account row itself, so a cookie for an account
// that no longer exists, or for another instance, reads as a visitor. State-changing routes also
// check Origin against RIVER_PUBLIC_ORIGIN.
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { loadViewer, type Viewer } from "../accounts.js";
import type { Instance } from "../instances.js";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, cookieHeader, decodeSession, encodeSession, readCookie } from "./cookies.js";

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The Set-Cookie value that starts a 30-day session for this account. */
export function sessionCookie(instanceId: string, accountId: string): string {
  const iat = nowSeconds();
  const token = encodeSession(env.sessionSecret, {
    v: 1,
    instance: instanceId,
    account: accountId,
    iat,
    exp: iat + SESSION_MAX_AGE_S,
  });
  return cookieHeader(SESSION_COOKIE, token, SESSION_MAX_AGE_S);
}

export function clearSessionCookie(): string {
  return cookieHeader(SESSION_COOKIE, "", 0);
}

/**
 * Express middleware (after requireInstance()): puts the signed-in member in res.locals.viewer,
 * or leaves it undefined for a visitor. A cookie that no longer names a member is cleared.
 */
export function readSession() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const raw = readCookie(req.get("cookie"), SESSION_COOKIE);
      if (raw === undefined) return next();
      const instance = res.locals.instance as Instance;
      const token = decodeSession(env.sessionSecret, raw, nowSeconds());
      const viewer: Viewer | undefined =
        token && token.instance === instance.id ? await loadViewer(instance.id, token.account) : undefined;
      if (viewer) res.locals.viewer = viewer;
      else res.append("Set-Cookie", clearSessionCookie());
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 401 unless a member is signed in (after readSession()). */
export function requireMember() {
  return (_req: Request, res: Response, next: NextFunction): void => {
    if (!res.locals.viewer) {
      res.status(401).json({ error: "sign_in_required", message: "Sign in to do that." });
      return;
    }
    next();
  };
}

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Appendix B: every state-changing request must come from the River's own pages. Browsers send
 * Origin on every POST, PUT, PATCH and DELETE; a missing or different one is refused.
 */
export function checkOrigin() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE.has(req.method)) return next();
    if (req.get("origin") !== env.riverPublicOrigin) {
      res.status(403).json({ error: "bad_origin", message: "This request didn't come from the River." });
      return;
    }
    next();
  };
}
