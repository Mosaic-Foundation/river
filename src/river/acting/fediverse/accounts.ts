// A member's linked fediverse accounts (fediverse-posting-1.md items 1.7 and 2; ADR-010 §3, §6):
// the list Settings → Linked accounts shows, and unlinking.
//
// Unlinking asks the server to revoke the token (`POST /oauth/revoke` with the app's credentials,
// redirects refused), then deletes the ciphertext whatever the server answered. The row stays,
// `unlinked` and without a credential, for Your activity; the list no longer shows it. Nothing here
// returns a token, a secret or ciphertext.
import { forAccount } from "../../../db/context.js";
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { openCredential } from "../crypto/credentials.js";
import { storedAppFor } from "./apps.js";
import { revokeToken } from "./oauth.js";
import { softwareLabel } from "./server.js";

export interface LinkedAccountView {
  id: string;
  /** `@ana@example.social`. */
  handle: string;
  server: string;
  displayName: string | null;
  avatarUrl: string | null;
  software: string | null;
  scopes: string[];
  /** active: can act. revoked: the server refused the token ("Link it again"). lapsed: unused 180 days. */
  status: "active" | "revoked" | "lapsed";
  linkedAt: string;
  lastUsedAt: string | null;
}

interface Row {
  id: string;
  acct: string | null;
  actor_uri: string;
  server_host: string;
  display_name: string | null;
  avatar_url: string | null;
  software: string | null;
  scopes: string;
  status: "active" | "revoked" | "lapsed";
  linked_at: Date;
  last_used_at: Date | null;
}

export async function listLinkedAccounts(instanceId: string, accountId: string): Promise<LinkedAccountView[]> {
  const rows = await forAccount(instanceId, accountId, async (db) => {
    const { rows } = await db.query<Row>(
      `SELECT id, acct, actor_uri, server_host, display_name, avatar_url, software, scopes, status, linked_at, last_used_at
         FROM river.linked_accounts
        WHERE kind = 'fediverse' AND status <> 'unlinked'
        ORDER BY created_at, id`,
    );
    return rows;
  });
  return rows.map((row) => ({
    id: row.id,
    handle: row.acct ? `@${row.acct}` : row.actor_uri,
    server: row.server_host,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    software: row.software ? softwareLabel(row.software) : null,
    scopes: row.scopes.split(/\s+/).filter(Boolean),
    status: row.status,
    linkedAt: row.linked_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
  }));
}

export interface UnlinkResult {
  handle: string;
  server: string;
  /** The server confirmed the revocation (a 200). False: the member is told to remove the app there too. */
  revokedThere: boolean;
}

interface TokenRow {
  id: string;
  acct: string | null;
  actor_uri: string;
  server_host: string;
  status: string;
  token_ciphertext: Buffer | null;
  token_dek: Buffer | null;
  token_key_version: number | null;
}

/** Unlinks one of the member's accounts; undefined when it isn't theirs or is already unlinked. */
export async function unlinkAccount(guard: FetchGuard, instanceId: string, accountId: string, id: string): Promise<UnlinkResult | undefined> {
  const row = await forAccount(instanceId, accountId, async (db) => {
    const { rows } = await db.query<TokenRow>(
      `SELECT id, acct, actor_uri, server_host, status, token_ciphertext, token_dek, token_key_version
         FROM river.linked_accounts WHERE id = $1 AND kind = 'fediverse' AND status <> 'unlinked'`,
      [id],
    );
    return rows[0];
  });
  if (!row) return undefined;

  let revokedThere = false;
  if (row.status === "active" && row.token_ciphertext && row.token_dek && row.token_key_version) {
    let token: string | undefined;
    try {
      token = openCredential(
        { instanceId, accountId, rowId: row.id, purpose: "fediverse_token" },
        { ciphertext: row.token_ciphertext, wrappedDek: row.token_dek, keyVersion: row.token_key_version },
      );
    } catch {
      token = undefined;
    }
    const app = token === undefined ? undefined : await storedAppFor(instanceId, row.server_host);
    if (token !== undefined && app) revokedThere = await revokeToken(guard, row.server_host, app, token);
  }

  await forAccount(instanceId, accountId, (db) =>
    db.query(
      `UPDATE river.linked_accounts
          SET status = 'unlinked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL,
              revoked_at = coalesce(revoked_at, now())
        WHERE id = $1 AND status <> 'unlinked'`,
      [row.id],
    ),
  );
  return { handle: row.acct ? `@${row.acct}` : row.actor_uri, server: row.server_host, revokedThere };
}
