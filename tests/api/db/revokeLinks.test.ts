// `npm run revoke-links` (ADR-010 §5; src/river/acting/revoke.ts), as river_app against the local
// database, with the servers stood in by undici's MockAgent behind the real fetch guard. It runs on
// the second instance (supabase/seed.sql) so it never touches other test files' links. Tokens are
// sealed with a test RIVER_TOKEN_KEY, as linking will seal them (A2).
import { randomBytes, randomUUID } from "node:crypto";
import { MockAgent } from "undici";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { forAccount, forInstance } from "../../../src/db/context.js";
import { sealClientSecret, sealCredential } from "../../../src/river/acting/crypto/credentials.js";
import { formatReport, revokeLinks } from "../../../src/river/acting/revoke.js";
import { createFetchGuard, type Resolver } from "../../../src/shared/fetch/index.js";
import { OTHER_INSTANCE, RIVER_URL, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);
const resolver: Resolver = async () => [{ address: "93.184.215.14", family: 4 }];

beforeAll(async () => {
  await requireDatabase(river, "river_app");
});

beforeEach(() => {
  vi.stubEnv("RIVER_TOKEN_KEY", randomBytes(32).toString("base64"));
});

afterAll(async () => {
  await river.end();
  vi.unstubAllEnvs();
});

const newHost = () => `${randomUUID().slice(0, 8)}.example`;

interface Link {
  id: string;
  host: string;
  token: string;
}

/** A new member of the second instance with one active link per entry. */
async function memberWithLinks(links: Array<{ host: string; kind?: "fediverse" | "mosaic_grant" }>) {
  const accountId = randomUUID();
  const made = await forAccount(
    OTHER_INSTANCE,
    accountId,
    async (db) => {
      await db.insert("accounts", { id: accountId });
      const out: Link[] = [];
      for (const { host, kind = "fediverse" } of links) {
        const id = randomUUID();
        const token = `tok-${randomBytes(12).toString("hex")}`;
        const purpose = kind === "fediverse" ? "fediverse_token" : "grant_token";
        const sealed = sealCredential({ instanceId: OTHER_INSTANCE, accountId, rowId: id, purpose }, token);
        await db.insert("linked_accounts", {
          id,
          kind,
          server_host: host,
          actor_uri: `https://${host}/users/${id}`,
          token_ciphertext: sealed.ciphertext,
          token_dek: sealed.wrappedDek,
          token_key_version: sealed.keyVersion,
        });
        out.push({ id, host, token });
      }
      return out;
    },
    river,
  );
  return { accountId, links: made };
}

async function registerApp(host: string, clientId: string, secret: string): Promise<void> {
  const sealed = sealClientSecret({ instanceId: OTHER_INSTANCE, host }, secret);
  await forInstance(
    OTHER_INSTANCE,
    (db) =>
      db.insert("oauth_clients", {
        host,
        software: "mastodon",
        software_version: "4.3.0",
        client_id: clientId,
        client_secret_ciphertext: sealed.ciphertext,
        client_secret_dek: sealed.wrappedDek,
        key_version: sealed.keyVersion,
        redirect_uri: "https://river.mosaic.social/api/auth/fediverse/callback",
        scopes: "profile write:statuses",
      }),
    river,
  );
}

async function linkRows(accountId: string) {
  return forAccount(
    OTHER_INSTANCE,
    accountId,
    async (db) =>
      (
        await db.query<{ id: string; status: string; has_token: boolean }>(
          "SELECT id, status, token_ciphertext IS NOT NULL AS has_token FROM river.linked_accounts ORDER BY id",
        )
      ).rows,
    river,
  );
}

function stubServers() {
  const agent = new MockAgent();
  agent.disableNetConnect();
  return { agent, guard: createFetchGuard({ resolver, dispatcher: agent }) };
}

describe("revoke-links", () => {
  it("revokes each link at its server, deletes every credential and app registration, and reports counts only", async () => {
    const [ok, down, redirecting] = [newHost(), newHost(), newHost()];
    await registerApp(ok, "client-a", "secret-a");
    await registerApp(down, "client-b", "secret-b");
    await registerApp(redirecting, "client-c", "secret-c");
    const member = await memberWithLinks([{ host: ok }, { host: down }, { host: redirecting }, { host: "id.mosaic.social", kind: "mosaic_grant" }]);

    const { agent, guard } = stubServers();
    const received: string[] = [];
    agent
      .get(`https://${ok}`)
      .intercept({ path: "/oauth/revoke", method: "POST" })
      .reply(200, (opts) => {
        received.push(String(opts.body));
        return "{}";
      });
    agent.get(`https://${down}`).intercept({ path: "/oauth/revoke", method: "POST" }).reply(503, "down");
    agent
      .get(`https://${redirecting}`)
      .intercept({ path: "/oauth/revoke", method: "POST" })
      .reply(307, "", { headers: { location: "https://elsewhere.example/steal" } });

    // A dry run opens each credential and changes nothing.
    const dry = await revokeLinks({ apply: false, instanceId: OTHER_INSTANCE, guard, source: river });
    expect(dry.hosts[ok]).toEqual({ links: 1, revokedThere: 0, notConfirmed: 0, unreadable: 0 });
    expect(received).toEqual([]);
    expect((await linkRows(member.accountId)).every((l) => l.status === "active" && l.has_token)).toBe(true);

    const report = await revokeLinks({ apply: true, instanceId: OTHER_INSTANCE, guard, source: river });
    expect(report.hosts[ok]).toEqual({ links: 1, revokedThere: 1, notConfirmed: 0, unreadable: 0 });
    expect(report.hosts[down]).toEqual({ links: 1, revokedThere: 0, notConfirmed: 1, unreadable: 0 });
    // The redirect was refused: the token went nowhere else (the MockAgent would have thrown for
    // elsewhere.example, which has no interceptor, and every interceptor was used once).
    expect(report.hosts[redirecting]).toEqual({ links: 1, revokedThere: 0, notConfirmed: 1, unreadable: 0 });
    agent.assertNoPendingInterceptors();
    expect(report.grants).toBeGreaterThanOrEqual(1);
    expect(report.appRegistrationsDeleted).toBeGreaterThanOrEqual(3);

    // The server got exactly the token and the app's credentials, form-encoded.
    expect(received).toHaveLength(1);
    expect(Object.fromEntries(new URLSearchParams(received[0]))).toEqual({
      client_id: "client-a",
      client_secret: "secret-a",
      token: member.links[0]!.token,
    });

    // Every credential is gone; the rows stay, revoked, for Your activity.
    const rows = await linkRows(member.accountId);
    expect(rows).toHaveLength(4);
    expect(rows.every((l) => l.status === "revoked" && !l.has_token)).toBe(true);
    const apps = await forInstance(OTHER_INSTANCE, async (db) => (await db.query("SELECT 1 FROM river.oauth_clients")).rowCount, river);
    expect(apps).toBe(0);

    const text = formatReport(report).join("\n");
    expect(text).toContain(`${ok}: 1 link, 1 revoked there, 0 not confirmed`);
    for (const secret of [...member.links.map((l) => l.token), "secret-a", "client-a"]) expect(text).not.toContain(secret);
  });

  it("with no app registration, or a credential this key can't open, still deletes it", async () => {
    const host = newHost();
    const member = await memberWithLinks([{ host }]);
    const { guard } = stubServers();
    // Another key: the stored credential no longer opens.
    vi.stubEnv("RIVER_TOKEN_KEY", randomBytes(32).toString("base64"));
    const dry = await revokeLinks({ apply: false, instanceId: OTHER_INSTANCE, guard, source: river });
    expect(dry.hosts[host]).toEqual({ links: 1, revokedThere: 0, notConfirmed: 0, unreadable: 1 });
    expect(formatReport(dry).join("\n")).toContain(`${host}: 1 link, 0 open with this key, 1 unreadable`);

    const applied = await revokeLinks({ apply: true, instanceId: OTHER_INSTANCE, guard, source: river });
    expect(applied.hosts[host]).toEqual({ links: 1, revokedThere: 0, notConfirmed: 1, unreadable: 1 });
    expect(await linkRows(member.accountId)).toEqual([{ id: member.links[0]!.id, status: "revoked", has_token: false }]);
  });
});
