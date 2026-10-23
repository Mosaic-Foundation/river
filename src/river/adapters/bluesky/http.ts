// Requests to Bluesky's public AppView and to DID documents, through the fetch guard the adapter is
// given (ADR-001, ADR-009 item 1). Unauthenticated GETs of public data only. Never retries: a 429
// is reported and the guard keeps the host's Retry-After for the next caller.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES } from "../../../shared/items/index.js";
import { adapterErrorFrom, RATE_LIMITED_MESSAGE } from "../fediverse/http.js";

/** Bluesky's public, cached AppView (ADR-009). */
export const APPVIEW = "https://public.api.bsky.app";
/** The PLC directory, for did:plc documents. */
export const PLC_DIRECTORY = "https://plc.directory";

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** An https URL, or undefined. */
export function httpsUrl(value: unknown): string | undefined {
  const text = str(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export interface Reply {
  status: number;
  /** The parsed JSON body (2xx and 4xx: XRPC errors carry `{error, message}`). */
  body?: unknown;
  text?: string;
}

/** GET through the guard. Guard failures become AdapterError; statuses go back to the caller. */
export async function get(guard: FetchGuard, url: string, accept = "application/json"): Promise<Reply> {
  let res: Response;
  try {
    res = await guard.fetch(url, { headers: { accept } });
  } catch (err) {
    throw adapterErrorFrom(err);
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    return { status: res.status };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, body, text };
}

/** `{APPVIEW}/xrpc/{method}?{params}`. */
export function xrpcUrl(method: string, params: Record<string, string | number | undefined>): string {
  const url = new URL(`/xrpc/${method}`, APPVIEW);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** The XRPC error name in a 4xx body (`InvalidRequest`, `AccountTakedown`...). */
export function xrpcError(reply: Reply): string | undefined {
  return isObject(reply.body) ? str(reply.body.error) : undefined;
}

/**
 * The AdapterError for a failed AppView call. An unknown, deactivated or taken-down account (a 400
 * from the AppView) isn't a Space; a 429 asks us to wait; anything else is unreachable.
 */
export function replyError(reply: Reply): AdapterError {
  if (reply.status === 429) return new AdapterError("unreachable", RATE_LIMITED_MESSAGE);
  if (reply.status === 400 || reply.status === 404 || reply.status === 410) {
    return new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  }
  return new AdapterError("unreachable", ADAPTER_MESSAGES.unreachable);
}

/** Calls an AppView method; returns the JSON object, or throws the follow box's AdapterError. */
export async function xrpc(
  guard: FetchGuard,
  method: string,
  params: Record<string, string | number | undefined>,
): Promise<Json> {
  const reply = await get(guard, xrpcUrl(method, params));
  if (reply.status !== 200) throw replyError(reply);
  if (!isObject(reply.body)) throw new AdapterError("unreachable", ADAPTER_MESSAGES.unreachable);
  return reply.body;
}
