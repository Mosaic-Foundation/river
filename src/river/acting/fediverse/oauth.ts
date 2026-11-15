// The OAuth requests that carry a credential (fediverse-posting-1.md items 1.6 and 1.7): the code
// exchange, verify_credentials and revocation. Every one refuses redirects (`redirect: "error"`),
// so a token or client secret is never sent to a host it wasn't issued for (ADR-011 item 6).
// Nothing here logs, or puts in an error, a token, a code, a verifier or a secret.
import { FetchError, type FetchGuard } from "../../../shared/fetch/index.js";
import { isObject } from "../../adapters/fediverse/activitypub.js";
import type { AppCredentials } from "./apps.js";

/** What went wrong, without detail: the callback maps it to a message. */
export class OAuthError extends Error {
  constructor(readonly reason: "busy" | "unreachable" | "invalid_client" | "refused" | "revoked" | "malformed") {
    super(`OAuth request failed: ${reason}`);
    this.name = "OAuthError";
  }
}

async function send(guard: FetchGuard, url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }) {
  let res: Response;
  try {
    res = await guard.fetch(url, { ...init, redirect: "error" });
  } catch (err) {
    if (err instanceof FetchError && err.code === "retry_later") throw new OAuthError("busy");
    // The server answered, with a redirect the credential mustn't follow: a refusal, not silence.
    if (err instanceof FetchError && err.code === "redirect_refused") throw new OAuthError("refused");
    throw new OAuthError("unreachable");
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { status: res.status, body: isObject(body) ? body : undefined };
}

function form(fields: Record<string, string>): { headers: Record<string, string>; body: string } {
  return {
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(fields).toString(),
  };
}

export interface IssuedToken {
  accessToken: string;
  /** The scopes the server says it granted, space-separated (may be empty). */
  scope: string;
}

/** `POST /oauth/token` with the code and the PKCE verifier. */
export async function exchangeCode(
  guard: FetchGuard,
  host: string,
  app: AppCredentials,
  fields: { code: string; redirectUri: string; verifier: string },
): Promise<IssuedToken> {
  const res = await send(guard, `https://${host}/oauth/token`, {
    method: "POST",
    ...form({
      grant_type: "authorization_code",
      code: fields.code,
      redirect_uri: fields.redirectUri,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code_verifier: fields.verifier,
    }),
  });
  if (res.status === 429) throw new OAuthError("busy");
  if (res.status === 401 && res.body?.error === "invalid_client") throw new OAuthError("invalid_client");
  if (res.status !== 200) throw new OAuthError("refused");
  const token = res.body?.access_token;
  if (typeof token !== "string" || token === "" || token.length > 4096) throw new OAuthError("malformed");
  const scope = typeof res.body?.scope === "string" ? res.body.scope : "";
  return { accessToken: token, scope };
}

/** `GET /api/v1/accounts/verify_credentials`: the account object, as the server gave it. */
export async function verifyCredentials(guard: FetchGuard, host: string, token: string): Promise<Record<string, unknown>> {
  const res = await send(guard, `https://${host}/api/v1/accounts/verify_credentials`, {
    method: "GET",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (res.status === 429) throw new OAuthError("busy");
  if (res.status === 401) throw new OAuthError("revoked");
  if (res.status !== 200 || !res.body) throw new OAuthError("refused");
  return res.body;
}

/** `POST /oauth/revoke`. True only for a 200; never throws. */
export async function revokeToken(guard: FetchGuard, host: string, app: AppCredentials, token: string): Promise<boolean> {
  try {
    const res = await send(guard, `https://${host}/oauth/revoke`, {
      method: "POST",
      ...form({ client_id: app.clientId, client_secret: app.clientSecret, token }),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}
