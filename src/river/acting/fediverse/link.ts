// Linking a member's fediverse account (fediverse-posting-1.md item 1; ADR-010 §3, ADR-011 item 3).
//
// startLink(): after the member has read what linking allows and clicked "Continue to {server}",
// find the server again (nothing the browser sent back is trusted), make sure the instance has an
// app there, store an attempt (its state, and the PKCE verifier sealed to the attempt's row) and
// give back the server's authorize URL. The browser goes there itself; the state cookie ties the
// callback to this browser.
//
// finishLink(): the callback (item 1.6). The state must match the cookie, and its attempt is
// consumed once, within 10 minutes. Then the code is exchanged (with the verifier), the account
// read with verify_credentials and compared with the one the member named, and the token stored,
// sealed to the linked account's row. A token for another account is revoked at once. Nothing is
// sent in the member's name here (ADR-010 §10): the callback only stores what came back.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { forAccount } from "../../../db/context.js";
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { sealCredential } from "../crypto/credentials.js";
import { isObject } from "../../adapters/fediverse/activitypub.js";
import { parseInput } from "../../adapters/fediverse/input.js";
import { webfinger } from "../../adapters/fediverse/resolve.js";
import { openCredential } from "../crypto/credentials.js";
import { appFor, forgetApp, storedAppFor } from "./apps.js";
import { exchangeCode, OAuthError, revokeToken, verifyCredentials } from "./oauth.js";
import { checkServer, findAccount, LinkError, type NamedAccount, type ServerInfo } from "./server.js";

/** A member may link up to this many fediverse accounts (item 1.1). */
export const MAX_LINKED_ACCOUNTS = 3;

/** How long an attempt (and its state cookie) is good for. */
export const ATTEMPT_TTL_MINUTES = 10;

/** The River's callback for every server (ADR-011 item 2). Under /api/auth/ for its headers (ADR-010 §10). */
export const FEDIVERSE_CALLBACK_PATH = "/api/auth/fediverse/callback";

/** Where the member returns to on the River. */
export const LINKED_ACCOUNTS_PATH = "/linked-accounts";

export function callbackUri(): string {
  return `${env.riverPublicOrigin}${FEDIVERSE_CALLBACK_PATH}`;
}

export interface StartedLink {
  /** The opaque state, for the state cookie. */
  state: string;
  authorizeUrl: string;
  account: NamedAccount;
  server: ServerInfo;
}

/** The server's authorize page for this attempt (item 1.5). Always PKCE S256. */
export function authorizeUrl(host: string, clientId: string, scopes: string[], state: string, challenge: string): string {
  const url = new URL(`https://${host}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callbackUri(),
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Refuses a fourth account; linking an account again is always allowed. */
async function checkRoom(instanceId: string, accountId: string, actorUri: string): Promise<void> {
  const others = await forAccount(instanceId, accountId, async (db) => {
    const { rows } = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM river.linked_accounts
        WHERE kind = 'fediverse' AND status = 'active' AND actor_uri <> $1`,
      [actorUri],
    );
    return rows[0]?.n ?? 0;
  });
  if (others >= MAX_LINKED_ACCOUNTS) {
    throw new LinkError(
      "too_many_links",
      `You've linked ${MAX_LINKED_ACCOUNTS} accounts, the most the River allows. Unlink one to link another.`,
    );
  }
}

export async function startLink(guard: FetchGuard, instanceId: string, accountId: string, input: string): Promise<StartedLink> {
  const account = await findAccount(guard, input);
  await checkRoom(instanceId, accountId, account.actorUri);
  const server = await checkServer(guard, account.host);
  const app = await appFor(guard, instanceId, server, callbackUri(), env.riverPublicOrigin);

  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const attemptId = randomUUID();
  const sealed = sealCredential({ instanceId, accountId, rowId: attemptId, purpose: "pkce_verifier" }, verifier);
  await forAccount(instanceId, accountId, (db) =>
    db.insert("acting_attempts", {
      id: attemptId,
      state,
      purpose: "fediverse_link",
      server_host: server.host,
      requested: account.handle,
      return_to: LINKED_ACCOUNTS_PATH,
      verifier_ciphertext: sealed.ciphertext,
      verifier_dek: sealed.wrappedDek,
      verifier_key_version: sealed.keyVersion,
    }),
  );
  return { state, authorizeUrl: authorizeUrl(server.host, app.clientId, server.scopes, state, challenge), account, server };
}

/** How a callback ended; the Linked accounts page says it in words. */
export type LinkResult =
  | "linked"
  | "denied"
  | "expired"
  | "different_account"
  | "too_many"
  | "busy"
  | "unreachable"
  | "failed";

interface AttemptRow {
  id: string;
  server_host: string;
  requested: string | null;
  verifier_ciphertext: Buffer | null;
  verifier_dek: Buffer | null;
  verifier_key_version: number | null;
}

/** Marks the attempt used and returns it; undefined when unknown, used, another purpose's, or over 10 minutes old. */
async function consumeAttempt(instanceId: string, accountId: string, state: string): Promise<AttemptRow | undefined> {
  return forAccount(instanceId, accountId, async (db) => {
    const { rows } = await db.query<AttemptRow>(
      `UPDATE river.acting_attempts SET used_at = now()
        WHERE state = $1 AND purpose = 'fediverse_link' AND used_at IS NULL
          AND created_at > now() - make_interval(mins => $2)
        RETURNING id, server_host, requested, verifier_ciphertext, verifier_dek, verifier_key_version`,
      [state, ATTEMPT_TTL_MINUTES],
    );
    return rows[0];
  });
}

const VISIBILITIES = new Set(["public", "unlisted", "private"]);

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value !== "" ? value.slice(0, max) : null;
}

function httpsOrNull(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * The actor URI of the account the token belongs to, if it is the account the member named on
 * this server; undefined otherwise. Mastodon gives `uri`; without one, WebFinger on the named
 * handle gives it (and the token's account must still have that name).
 */
async function matchingActor(
  guard: FetchGuard,
  host: string,
  requested: string,
  account: Record<string, unknown>,
): Promise<string | undefined> {
  const named = parseInput(requested);
  if (named?.kind !== "handle") return undefined;
  const acct = typeof account.acct === "string" ? account.acct.toLowerCase() : "";
  // A local account's acct is its username; one with a domain must be the named domain.
  const sameName = acct === named.name.toLowerCase() || acct === `${named.name}@${named.server}`.toLowerCase();
  if (!sameName) return undefined;
  let actor = typeof account.uri === "string" ? account.uri : undefined;
  if (actor === undefined) {
    try {
      actor = await webfinger(guard, named.name, named.server);
    } catch {
      return undefined;
    }
  }
  return hostOf(actor) === host && actor.length <= 2048 ? actor : undefined;
}

export interface CallbackInput {
  /** The state from the query, and the one the cookie carried (undefined when absent or forged). */
  state: unknown;
  cookieState: string | undefined;
  code: unknown;
  error: unknown;
}

export async function finishLink(guard: FetchGuard, instanceId: string, accountId: string, input: CallbackInput): Promise<LinkResult> {
  if (typeof input.state !== "string" || input.cookieState === undefined || input.state !== input.cookieState) return "expired";
  const attempt = await consumeAttempt(instanceId, accountId, input.state);
  if (!attempt || !attempt.requested || !attempt.verifier_ciphertext || !attempt.verifier_dek || !attempt.verifier_key_version) {
    return "expired";
  }
  if (input.error !== undefined) return "denied";
  if (typeof input.code !== "string" || input.code === "" || input.code.length > 2048) return "failed";

  const host = attempt.server_host;
  const app = await storedAppFor(instanceId, host);
  if (!app) return "failed";
  const verifier = openCredential(
    { instanceId, accountId, rowId: attempt.id, purpose: "pkce_verifier" },
    { ciphertext: attempt.verifier_ciphertext, wrappedDek: attempt.verifier_dek, keyVersion: attempt.verifier_key_version },
  );

  let token: string;
  let scope: string;
  try {
    ({ accessToken: token, scope } = await exchangeCode(guard, host, app, { code: input.code, redirectUri: callbackUri(), verifier }));
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    // The server forgot the River's app: forget it here too, so the next link registers again.
    if (err.reason === "invalid_client") await forgetApp(instanceId, host, app.clientId);
    return err.reason === "busy" ? "busy" : err.reason === "unreachable" ? "unreachable" : "failed";
  }

  let account: Record<string, unknown>;
  try {
    account = await verifyCredentials(guard, host, token);
  } catch (err) {
    if (!(err instanceof OAuthError)) throw err;
    await revokeToken(guard, host, app, token);
    return err.reason === "busy" ? "busy" : err.reason === "unreachable" ? "unreachable" : "failed";
  }

  const actorUri = await matchingActor(guard, host, attempt.requested, account);
  const remoteId = text(account.id, 256);
  if (!actorUri || !remoteId) {
    await revokeToken(guard, host, app, token);
    return "different_account";
  }

  const handle = attempt.requested.replace(/^@/, "");
  const source = isObject(account.source) ? account.source : undefined;
  const privacy = typeof source?.privacy === "string" && VISIBILITIES.has(source.privacy) ? source.privacy : null;
  const language = typeof source?.language === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(source.language) ? source.language.slice(0, 16) : null;
  const grantedScopes = (scope.trim() || "").slice(0, 512);

  const stored = await forAccount(instanceId, accountId, async (db) => {
    // The account's row lock keeps two callbacks from both taking the last of the three places.
    await db.query("SELECT 1 FROM river.accounts WHERE id = $1 FOR UPDATE", [accountId]);
    const { rows: existing } = await db.query<{ id: string }>(
      "SELECT id FROM river.linked_accounts WHERE kind = 'fediverse' AND actor_uri = $1",
      [actorUri],
    );
    const { rows: counted } = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM river.linked_accounts WHERE kind = 'fediverse' AND status = 'active' AND actor_uri <> $1",
      [actorUri],
    );
    if ((counted[0]?.n ?? 0) >= MAX_LINKED_ACCOUNTS) return false;

    const rowId = existing[0]?.id ?? randomUUID();
    const sealed = sealCredential({ instanceId, accountId, rowId, purpose: "fediverse_token" }, token);
    const fields = {
      acct: handle.slice(0, 512),
      remote_account_id: remoteId,
      display_name: text(account.display_name, 512),
      avatar_url: httpsOrNull(account.avatar),
      software: app.software,
      scopes: grantedScopes,
      token_ciphertext: sealed.ciphertext,
      token_dek: sealed.wrappedDek,
      token_key_version: sealed.keyVersion,
      default_visibility: privacy,
      default_language: language,
    };
    if (existing[0]) {
      const names = Object.keys(fields);
      await db.query(
        `UPDATE river.linked_accounts
            SET ${names.map((name, i) => `${name} = $${i + 2}`).join(", ")},
                status = 'active', linked_at = now(), revoked_at = NULL
          WHERE id = $1`,
        [rowId, ...Object.values(fields)],
      );
    } else {
      await db.insert("linked_accounts", { id: rowId, kind: "fediverse", server_host: host, actor_uri: actorUri, ...fields });
    }
    return true;
  });
  if (!stored) {
    await revokeToken(guard, host, app, token);
    return "too_many";
  }
  return "linked";
}
