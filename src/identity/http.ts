// Request and response helpers for the identity host: security headers (Appendix B), the
// caller's IP for rate limits, and the same-origin check on every POST.
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { identityConfig } from "./config.js";

/**
 * Appendix B: no inline scripts, connect-src 'self', img-src 'self' https:. identity/vercel.json
 * sends the same value for static files (tests/unit/identityHttp.test.ts keeps them equal).
 */
export const IDENTITY_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https:; font-src 'self'; " +
  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", IDENTITY_CSP);
  // Emailed tokens travel in URLs; never send them to another origin as a Referer. (Not
  // no-referrer: with it, browsers send `Origin: null` on form posts and the check below fails.)
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  next();
}

/** Pages and API answers that carry ceremony state are never cached. */
export function noStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Cache-Control", "no-store");
  next();
}

/**
 * The caller's address. On Vercel the platform sets x-real-ip (and the first x-forwarded-for
 * entry) itself; elsewhere a header could be forged, so the socket address is used.
 */
export function clientIp(req: Request): string {
  if (env.onVercel) {
    const real = req.headers["x-real-ip"];
    if (typeof real === "string" && real !== "") return real;
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded !== "") return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Every POST must come from the identity host's own pages: the Origin header (which browsers
 * always send on POST) must equal IDENTITY_PUBLIC_ORIGIN.
 */
export function sameOriginPosts(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "POST") return next();
  if (req.headers.origin !== identityConfig().origin) {
    res.status(403).json({ error: "cross_origin", message: "This request didn't come from Mosaic ID." });
    return;
  }
  next();
}
