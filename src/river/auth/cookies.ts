// The River's two cookies (spec 4.6 step 1, Appendix B "Sessions"). Both are HttpOnly, Secure,
// SameSite=Lax, Path=/ and host-only (the __Host- prefix makes the browser refuse them otherwise),
// and both are signed with SESSION_SECRET (HMAC-SHA256, a separate derived key per purpose). Their
// names differ from anything the identity host could set: cookies ignore ports on localhost.
//
//   __Host-river-signin   the sign-in state, 10 minutes; ties the callback to the browser that
//                         started the sign-in
//   __Host-river-session  the member's session, 30 days: a signed, stateless token
//                         {v, instance, account, iat, exp} (DECISIONS, M8)
//
// Nothing here logs a cookie or a token.
import { createHmac, timingSafeEqual } from "node:crypto";

export const STATE_COOKIE = "__Host-river-signin";
export const SESSION_COOKIE = "__Host-river-session";
export const STATE_MAX_AGE_S = 10 * 60;
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

type Purpose = "signin-state" | "session";

function key(secret: string, purpose: Purpose): Buffer {
  if (secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return createHmac("sha256", secret).update(`mosaic-river ${purpose} v1`).digest();
}

function mac(secret: string, purpose: Purpose, value: string): string {
  return createHmac("sha256", key(secret, purpose)).update(value).digest("base64url");
}

/** `value.mac`. The MAC (base64url, no dots) is always the part after the last dot. */
export function sign(secret: string, purpose: Purpose, value: string): string {
  return `${value}.${mac(secret, purpose, value)}`;
}

/** The value inside a signed string, or undefined when the MAC doesn't match. */
export function unsign(secret: string, purpose: Purpose, signed: string | undefined): string | undefined {
  if (!signed) return undefined;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const value = signed.slice(0, dot);
  const given = Buffer.from(signed.slice(dot + 1), "utf8");
  const expected = Buffer.from(mac(secret, purpose, value), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : undefined;
}

/** Reads one cookie from a Cookie header; undefined when absent or repeated. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  let found: string | undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    // Two cookies of one name (one could be planted by a sibling host): trust neither.
    if (found !== undefined) return undefined;
    found = part.slice(eq + 1).trim();
  }
  return found;
}

/** A Set-Cookie value with the River's fixed attributes. maxAge 0 clears it. */
export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export interface SessionToken {
  v: 1;
  instance: string;
  account: string;
  /** Seconds since the epoch. */
  iat: number;
  exp: number;
}

export function encodeSession(secret: string, token: SessionToken): string {
  return sign(secret, "session", Buffer.from(JSON.stringify(token), "utf8").toString("base64url"));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A valid, unexpired session token, or undefined. */
export function decodeSession(secret: string, raw: string | undefined, nowSeconds: number): SessionToken | undefined {
  const value = unsign(secret, "session", raw);
  if (value === undefined) return undefined;
  try {
    const token = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<SessionToken>;
    if (
      token.v === 1 &&
      typeof token.instance === "string" &&
      UUID.test(token.instance) &&
      typeof token.account === "string" &&
      UUID.test(token.account) &&
      typeof token.iat === "number" &&
      typeof token.exp === "number" &&
      token.iat <= nowSeconds + 60 &&
      token.exp > nowSeconds
    ) {
      return token as SessionToken;
    }
  } catch {
    // fall through
  }
  return undefined;
}
