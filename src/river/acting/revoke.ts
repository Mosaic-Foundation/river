// `npm run revoke-links` (ADR-010 §5, "What a leak costs"): after the database and RIVER_TOKEN_KEY
// may both have leaked, every credential the River holds is revoked where it was issued and deleted
// here. Adam runs it from his own machine (docs/deploy.md, "If RIVER_TOKEN_KEY leaks"); nothing in
// the River calls it.
//
// For each active link, on every instance (or one):
//   fediverse     POST https://{server}/oauth/revoke (client_id, client_secret, token) through the
//                 fetch guard, refusing redirects so the token goes nowhere else; then the token is
//                 deleted whatever the answer, and the link reads `revoked` ("Link it again").
//   mosaic_grant  the grant token is deleted; Mosaic ID revokes every grant of the River's client
//                 on its side (B2 adds that step; the runbook says so).
// Then each instance's app registrations are deleted, since their client secrets leaked too: the
// next link registers a fresh app.
//
// A dry run (the default) opens each credential to show the key works and changes nothing. The
// report names servers and counts, never a token, a secret, an account or a handle.
import { forAccount, forHost, forInstance, type ClientSource } from "../../db/context.js";
import { getFetchGuard, FetchError, type FetchGuard } from "../../shared/fetch/index.js";
import { openClientSecret, openCredential } from "./crypto/credentials.js";

export interface RevokeOptions {
  /** false: open each credential and report, change nothing. */
  apply: boolean;
  /** Only this instance (default: every instance). */
  instanceId?: string;
  guard?: FetchGuard;
  source?: ClientSource;
}

export interface HostReport {
  /** Active links found. */
  links: number;
  /** The server answered 200 to the revoke. */
  revokedThere: number;
  /** The server didn't answer, refused, or the credential couldn't be opened: remove the app there by hand if possible. */
  notConfirmed: number;
  /** Links whose credential could not be opened with this RIVER_TOKEN_KEY. */
  unreadable: number;
}

export interface RevokeReport {
  apply: boolean;
  hosts: Record<string, HostReport>;
  grants: number;
  appRegistrationsDeleted: number;
}

interface LinkRow {
  id: string;
  kind: "fediverse" | "mosaic_grant";
  server_host: string;
  token_ciphertext: Buffer;
  token_dek: Buffer;
  token_key_version: number;
}

interface ClientRow {
  client_id: string;
  client_secret_ciphertext: Buffer;
  client_secret_dek: Buffer;
  key_version: number;
}

function hostReport(report: RevokeReport, host: string): HostReport {
  report.hosts[host] ??= { links: 0, revokedThere: 0, notConfirmed: 0, unreadable: 0 };
  return report.hosts[host];
}

/** The server's client credentials, opened, or undefined when there are none or they won't open. */
async function clientFor(instanceId: string, host: string, source?: ClientSource): Promise<{ id: string; secret: string } | undefined> {
  const row = await forInstance(
    instanceId,
    async (db) =>
      (
        await db.query<ClientRow>(
          "SELECT client_id, client_secret_ciphertext, client_secret_dek, key_version FROM river.oauth_clients WHERE host = $1",
          [host],
        )
      ).rows[0],
    source,
  );
  if (!row) return undefined;
  try {
    const secret = openClientSecret(
      { instanceId, host },
      { ciphertext: row.client_secret_ciphertext, wrappedDek: row.client_secret_dek, keyVersion: row.key_version },
    );
    return { id: row.client_id, secret };
  } catch {
    return undefined;
  }
}

/** Asks the server to revoke the token. True only for a 200; never throws, never retries. */
async function revokeAtServer(guard: FetchGuard, host: string, client: { id: string; secret: string }, token: string): Promise<boolean> {
  try {
    const res = await guard.fetch(`https://${host}/oauth/revoke`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, token }).toString(),
      redirect: "error",
    });
    return res.status === 200;
  } catch (err) {
    if (err instanceof FetchError) return false;
    throw err;
  }
}

export async function revokeLinks(options: RevokeOptions): Promise<RevokeReport> {
  const { apply, source } = options;
  const guard = options.guard ?? getFetchGuard();
  const report: RevokeReport = { apply, hosts: {}, grants: 0, appRegistrationsDeleted: 0 };

  const instanceIds = options.instanceId
    ? [options.instanceId]
    : await forHost(async (db) => (await db.query<{ id: string }>("SELECT id FROM river.instances ORDER BY id")).rows.map((r) => r.id), source);

  for (const instanceId of instanceIds) {
    const accountIds = await forInstance(
      instanceId,
      async (db) => (await db.query<{ id: string }>("SELECT id FROM river.accounts ORDER BY id")).rows.map((r) => r.id),
      source,
    );
    const clients = new Map<string, { id: string; secret: string } | undefined>();

    for (const accountId of accountIds) {
      const links = await forAccount(
        instanceId,
        accountId,
        async (db) =>
          (
            await db.query<LinkRow>(
              `SELECT id, kind, server_host, token_ciphertext, token_dek, token_key_version
                 FROM river.linked_accounts WHERE status = 'active' ORDER BY id`,
            )
          ).rows,
        source,
      );
      for (const link of links) {
        let token: string | undefined;
        try {
          token = openCredential(
            { instanceId, accountId, rowId: link.id, purpose: link.kind === "fediverse" ? "fediverse_token" : "grant_token" },
            { ciphertext: link.token_ciphertext, wrappedDek: link.token_dek, keyVersion: link.token_key_version },
          );
        } catch {
          token = undefined;
        }

        if (link.kind === "mosaic_grant") {
          report.grants += 1;
        } else {
          const counts = hostReport(report, link.server_host);
          counts.links += 1;
          if (token === undefined) counts.unreadable += 1;
          if (apply) {
            if (!clients.has(link.server_host)) clients.set(link.server_host, await clientFor(instanceId, link.server_host, source));
            const client = clients.get(link.server_host);
            const confirmed = token !== undefined && client !== undefined && (await revokeAtServer(guard, link.server_host, client, token));
            if (confirmed) counts.revokedThere += 1;
            else counts.notConfirmed += 1;
          }
        }

        if (apply) {
          await forAccount(
            instanceId,
            accountId,
            (db) =>
              db.query(
                `UPDATE river.linked_accounts
                    SET status = 'revoked', token_ciphertext = NULL, token_dek = NULL, token_key_version = NULL, revoked_at = now()
                  WHERE id = $1 AND status = 'active'`,
                [link.id],
              ),
            source,
          );
        }
      }
    }

    if (apply) {
      report.appRegistrationsDeleted += await forInstance(
        instanceId,
        async (db) => (await db.query("DELETE FROM river.oauth_clients")).rowCount ?? 0,
        source,
      );
    }
  }
  return report;
}

/** The report as lines for the terminal: servers and counts only. */
export function formatReport(report: RevokeReport): string[] {
  const lines = [report.apply ? "Revoked and deleted:" : "Dry run (nothing changed; run with --apply to revoke):"];
  const hosts = Object.entries(report.hosts).sort(([a], [b]) => a.localeCompare(b));
  if (hosts.length === 0) lines.push("  no active fediverse links");
  for (const [host, c] of hosts) {
    const detail = report.apply
      ? `${c.revokedThere} revoked there, ${c.notConfirmed} not confirmed`
      : `${c.links - c.unreadable} open with this key`;
    lines.push(`  ${host}: ${c.links} link${c.links === 1 ? "" : "s"}, ${detail}${c.unreadable ? `, ${c.unreadable} unreadable` : ""}`);
  }
  lines.push(`  Mosaic ID grants: ${report.grants}${report.apply ? " deleted here" : ""}`);
  if (report.apply) lines.push(`  App registrations deleted: ${report.appRegistrationsDeleted}`);
  return lines;
}
