// App registration, once per server and River instance (fediverse-posting-1.md item 1.4; ADR-011
// item 2). The River registers as "Mosaic River" with its callback and the scopes item 1.4 lists,
// and keeps `client_id` and the sealed `client_secret` in river.oauth_clients for every member of
// the instance on that server. A registration whose redirect URI, scopes or software no longer
// match is replaced by a new one.
//
// `POST /api/v1/apps` carries no credential, but its answer is one, so it refuses redirects too.
// Nothing here logs or returns the secret except to the caller that sends it to the same server.
import { forInstance } from "../../../db/context.js";
import { FetchError, type FetchGuard } from "../../../shared/fetch/index.js";
import { openClientSecret, sealClientSecret } from "../crypto/credentials.js";
import { busy, LinkError, unreachable, type ServerInfo } from "./server.js";

export const CLIENT_NAME = "Mosaic River";

export interface AppCredentials {
  clientId: string;
  clientSecret: string;
}

interface ClientRow {
  client_id: string;
  client_secret_ciphertext: Buffer;
  client_secret_dek: Buffer;
  key_version: number;
  redirect_uri: string;
  scopes: string;
  software: string;
  software_version: string;
}

async function storedApp(instanceId: string, host: string): Promise<ClientRow | undefined> {
  return forInstance(instanceId, async (db) => {
    const { rows } = await db.query<ClientRow>(
      `SELECT client_id, client_secret_ciphertext, client_secret_dek, key_version, redirect_uri, scopes, software, software_version
         FROM river.oauth_clients WHERE host = $1`,
      [host],
    );
    return rows[0];
  });
}

function opened(instanceId: string, host: string, row: ClientRow): AppCredentials | undefined {
  try {
    const clientSecret = openClientSecret(
      { instanceId, host },
      { ciphertext: row.client_secret_ciphertext, wrappedDek: row.client_secret_dek, keyVersion: row.key_version },
    );
    return { clientId: row.client_id, clientSecret };
  } catch {
    // Sealed under a key this process doesn't hold (a rotation): register again.
    return undefined;
  }
}

/** Registers the River with the server. Throws a LinkError the member can read. */
export async function registerApp(guard: FetchGuard, server: ServerInfo, redirectUri: string, website: string): Promise<AppCredentials> {
  const form = new URLSearchParams();
  form.set("client_name", CLIENT_NAME);
  form.append("redirect_uris[]", redirectUri);
  form.set("scopes", server.scopes.join(" "));
  form.set("website", website);
  let res: Response;
  try {
    res = await guard.fetch(`https://${server.host}/api/v1/apps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
      redirect: "error",
    });
  } catch (err) {
    if (err instanceof FetchError && err.code === "retry_later") throw busy(server.host);
    throw unreachable(server.host);
  }
  const text = await res.text();
  // Mastodon allows 5 registrations per 10 minutes from one address, and Vercel's are shared.
  if (res.status === 429) throw busy(server.host);
  if (res.status !== 200) {
    throw new LinkError("registration_refused", `${server.host} didn't let the River register. Try again later.`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const { client_id: clientId, client_secret: clientSecret } = (body ?? {}) as Record<string, unknown>;
  if (
    typeof clientId !== "string" || clientId === "" || clientId.length > 512 ||
    typeof clientSecret !== "string" || clientSecret === "" || clientSecret.length > 1024
  ) {
    throw new LinkError("registration_refused", `${server.host} didn't let the River register. Try again later.`);
  }
  return { clientId, clientSecret };
}

/**
 * The instance's app on this server: the stored one when it still matches (redirect URI, scopes,
 * software), else a new registration, stored before it is used.
 */
export async function appFor(
  guard: FetchGuard,
  instanceId: string,
  server: ServerInfo,
  redirectUri: string,
  website: string,
): Promise<AppCredentials> {
  const scopes = server.scopes.join(" ");
  const row = await storedApp(instanceId, server.host);
  if (row && row.redirect_uri === redirectUri && row.scopes === scopes && row.software === server.software) {
    const app = opened(instanceId, server.host, row);
    if (app) {
      if (row.software_version !== server.version) {
        await forInstance(instanceId, (db) =>
          db.query("UPDATE river.oauth_clients SET software_version = $2 WHERE host = $1", [server.host, server.version]),
        );
      }
      return app;
    }
  }

  const app = await registerApp(guard, server, redirectUri, website);
  const sealed = sealClientSecret({ instanceId, host: server.host }, app.clientSecret);
  return forInstance(instanceId, async (db) => {
    if (row) await db.query("DELETE FROM river.oauth_clients WHERE host = $1 AND client_id = $2", [server.host, row.client_id]);
    const inserted = await db.query<{ client_id: string }>(
      `INSERT INTO river.oauth_clients
         (host, software, software_version, client_id, client_secret_ciphertext, client_secret_dek, key_version, redirect_uri, scopes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (instance_id, host) DO NOTHING
       RETURNING client_id`,
      [server.host, server.software, server.version, app.clientId, sealed.ciphertext, sealed.wrappedDek, sealed.keyVersion, redirectUri, scopes],
    );
    if (inserted.rows.length === 1) return app;
    // Another request registered at the same moment; its app is the one stored, so use it (ours
    // is left unused on the server, holding no member's authorization).
    const { rows } = await db.query<ClientRow>(
      `SELECT client_id, client_secret_ciphertext, client_secret_dek, key_version, redirect_uri, scopes, software, software_version
         FROM river.oauth_clients WHERE host = $1`,
      [server.host],
    );
    const theirs = rows[0] ? opened(instanceId, server.host, rows[0]) : undefined;
    return theirs ?? app;
  });
}

/** The instance's stored app on this server, opened, with its software; undefined if none opens. */
export async function storedAppFor(instanceId: string, host: string): Promise<(AppCredentials & { software: string }) | undefined> {
  const row = await storedApp(instanceId, host);
  const app = row ? opened(instanceId, host, row) : undefined;
  return app && row ? { ...app, software: row.software } : undefined;
}

/** Forgets the instance's app on this server (it answered `invalid_client`): the next link registers again. */
export async function forgetApp(instanceId: string, host: string, clientId: string): Promise<void> {
  await forInstance(instanceId, (db) => db.query("DELETE FROM river.oauth_clients WHERE host = $1 AND client_id = $2", [host, clientId]));
}
