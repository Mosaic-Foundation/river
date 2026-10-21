// Reads through the fetch guard the adapter is given (ADR-001) and turns what went wrong into the
// follow box's terms (spec F6). Never retries: a 429 is reported and the guard keeps the host's
// Retry-After for the next caller.
import { FetchError, followMessage, type FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES } from "../../../shared/items/index.js";
import { isObject, type AsObject } from "./activitypub.js";

/** The sentence spec 4.3 gives for a server that only answers signed requests. */
export const SERVER_ONLY_MESSAGE =
  "This server only shares posts with other servers. The River will be able to read it once it has its own fediverse address.";

export const RATE_LIMITED_MESSAGE = "The server asked us to wait before reading it again";

export interface JsonResponse {
  status: number;
  /** The parsed body when the status is 2xx and the body is a JSON object or array. */
  body?: unknown;
  /** The final URL after redirects. */
  url: string;
}

/** Maps a guard error to the follow box's reason: off-limits addresses are refused, the rest unreachable. */
export function adapterErrorFrom(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  if (err instanceof FetchError) {
    if (err.code === "retry_later") return new AdapterError("unreachable", RATE_LIMITED_MESSAGE);
    const message = followMessage(err);
    return new AdapterError(message === ADAPTER_MESSAGES.refused ? "refused" : "unreachable", message);
  }
  return new AdapterError("unreachable", ADAPTER_MESSAGES.unreachable);
}

/** GET a JSON document. Guard failures become AdapterError; HTTP statuses are returned to the caller. */
export async function getJson(guard: FetchGuard, url: string, accept: string): Promise<JsonResponse> {
  let res: Response;
  try {
    res = await guard.fetch(url, { headers: { accept } });
  } catch (err) {
    throw adapterErrorFrom(err);
  }
  const finalUrl = res.url || url;
  if (res.status < 200 || res.status >= 300) {
    await res.body?.cancel();
    return { status: res.status, url: finalUrl };
  }
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    body = undefined;
  }
  return { status: res.status, body, url: finalUrl };
}

/** Throws the right AdapterError for a non-2xx status (429 included: reported, never retried). */
export function statusError(status: number, notFound: AdapterError["reason"] = "not_a_space"): AdapterError {
  if (status === 429) return new AdapterError("unreachable", RATE_LIMITED_MESSAGE);
  if (status === 404 || status === 410) return new AdapterError(notFound, ADAPTER_MESSAGES[notFound]);
  if (status === 401 || status === 403) return new AdapterError("server_only", SERVER_ONLY_MESSAGE);
  return new AdapterError("unreachable", ADAPTER_MESSAGES.unreachable);
}

/** The body as an object, or undefined. */
export function objectBody(res: JsonResponse): AsObject | undefined {
  return isObject(res.body) ? res.body : undefined;
}
