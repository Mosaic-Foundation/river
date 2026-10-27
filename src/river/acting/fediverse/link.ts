// Linking a member's fediverse account (fediverse-posting-1.md item 1; ADR-010 §3, ADR-011 item 3).
//
// startLink(): after the member has read what linking allows and clicked "Continue to {server}",
// find the server again (nothing the browser sent back is trusted), make sure the instance has an
// app there, store an attempt (its state, and the PKCE verifier sealed to the attempt's row) and
// give back the server's authorize URL. The browser goes there itself; the state cookie ties the
// callback to this browser.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { env } from "../../../config/env.js";
import { forAccount } from "../../../db/context.js";
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { sealCredential } from "../crypto/credentials.js";
import { appFor } from "./apps.js";
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
