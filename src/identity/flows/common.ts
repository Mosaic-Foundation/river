// Small helpers the identity flows share.
import type { NextFunction, Request, Response, Router } from "express";
import { clientIp } from "../http.js";
import { errorPage } from "../pages.js";
import { hit, type LimitName } from "../rateLimit.js";

type Handler = (req: Request, res: Response) => Promise<void> | void;

/** GET and POST with async handlers whose rejections reach Express's error handler. */
export interface Routes {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
}

export function asyncRoutes(router: Router): Routes {
  const wrap = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => handler(req, res))
      .catch(next);
  };
  return {
    get: (path, handler) => void router.get(path, wrap(handler)),
    post: (path, handler) => void router.post(path, wrap(handler)),
  };
}

/** A JSON error for the passkey script, which shows `message` to the person. */
export function fail(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

export const MESSAGES = {
  tooMany: "Too many attempts from here. Wait a few minutes, then try again.",
  gone: "This page has expired. Go back to Mosaic River and start again.",
  passkeyFailed: "That passkey didn't work for this request. Try again.",
  unknownPasskey: "We don't know that passkey. Create a Mosaic ID, or use “Lost your passkey?”.",
  invalidEmail: "Enter a valid email address.",
  emailInUse: "That address already has a Mosaic ID. Sign in with your passkey, or use “Lost your passkey?”.",
} as const;

/** Counts a hit against `name` for the caller's IP; answers 429 and returns false when over. */
export function allow(req: Request, res: Response, name: LimitName, html = false): boolean {
  if (hit(name, clientIp(req))) return true;
  res.setHeader("Retry-After", "300");
  if (html) {
    res.status(429).type("html").send(errorPage("Too many attempts", MESSAGES.tooMany));
  } else {
    fail(res, 429, "rate_limited", MESSAGES.tooMany);
  }
  return false;
}

/** An opaque state or nonce from the River: 16 to 256 URL-safe characters. */
export function opaqueParam(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{16,256}$/.test(value) ? value : undefined;
}

/**
 * An optional display name: trimmed, 1 to 64 characters, no control or invisible formatting
 * characters (bidi overrides, zero-width marks, line separators). It is quoted in the confirm email
 * and page, so it mustn't be able to reorder or hide the text around it.
 */
export function displayNameParam(value: unknown): string | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name === "") return undefined;
  if (name.length > 64 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return null;
  return name;
}
