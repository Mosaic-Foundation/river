// ADR-010 §9 and §10, as river_app against the local database: the per-account limits counted
// under the account's row lock, the session epoch checked at Send, a preview sent at most once and
// only within 15 minutes, and an act through a link that is no longer active refused
// (src/river/acting/acts.ts). Each test uses its own new member.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount } from "../../../src/db/context.js";
import { endAllSessions } from "../../../src/river/accounts.js";
import {
  ActRefused,
  claimPreview,
  createPreview,
  finishAct,
  startToggle,
  type ActInput,
  type Actor,
} from "../../../src/river/acting/acts.js";
import { RIVER_URL, SEED_INSTANCE, requireDatabase, rolePool } from "./roles.js";

const river = rolePool(RIVER_URL);

beforeAll(async () => {
  await requireDatabase(river, "river_app");
});

afterAll(async () => {
  await river.end();
});

async function newMember(): Promise<Actor & { linkId: string }> {
  const accountId = randomUUID();
  const linkId = await forAccount(
    SEED_INSTANCE,
    accountId,
    async (db) => {
      await db.insert("accounts", { id: accountId });
      const link = await db.insert<{ id: string }>("linked_accounts", {
        kind: "fediverse",
        server_host: "example.social",
        actor_uri: "https://example.social/users/ana",
        token_ciphertext: Buffer.alloc(48, 1),
        token_dek: Buffer.alloc(60, 2),
        token_key_version: 1,
      });
      return link.id;
    },
    river,
  );
  return { instanceId: SEED_INSTANCE, accountId, sessionEpoch: 1, linkId };
}

const post = (linkId: string): ActInput => ({
  channel: "fediverse",
  verb: "post",
  linkedAccountId: linkId,
  targetHost: "example.social",
  targetLabel: "@ana@example.social",
  request: { method: "POST", url: "https://example.social/api/v1/statuses", fields: { status: "Hello" } },
});

const boost = (linkId: string): ActInput => ({ ...post(linkId), verb: "boost", request: undefined });

/** Inserts `n` sent acts of a verb, `ago` ms before `at`, as if made then. */
async function history(member: Actor & { linkId: string }, verb: string, kind: string, n: number, at: Date, ago: number) {
  const when = new Date(at.getTime() - ago);
  await forAccount(
    SEED_INSTANCE,
    member.accountId,
    async (db) => {
      for (let i = 0; i < n; i++) {
        await db.insert("member_actions", {
          channel: "fediverse",
          verb,
          limit_kind: kind,
          target_host: "example.social",
          status: "sent",
          session_epoch: 1,
          created_at: when,
          sent_at: when,
        });
      }
    },
    river,
  );
}

async function refusedWith(promise: Promise<unknown>): Promise<ActRefused> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ActRefused) return err;
    throw err;
  }
  throw new Error("expected the act to be refused");
}

async function sendPost(member: Actor & { linkId: string }, at: Date) {
  const preview = await createPreview(member, post(member.linkId), at, river);
  return claimPreview(member, preview.id, at, river);
}

describe("acting limits (ADR-010 §9)", () => {
  it("the 31st text act in an hour is refused, with when it may go; previews don't count", async () => {
    const member = await newMember();
    const at = new Date();
    await history(member, "post", "text", 29, at, 50 * 60_000);
    // Previews never sent don't count.
    for (let i = 0; i < 5; i++) await createPreview(member, post(member.linkId), at, river);
    const thirtieth = await sendPost(member, at);
    expect(thirtieth.status).toBe("unknown");
    const refused = await refusedWith(sendPost(member, at));
    expect(refused.code).toBe("limit");
    // The 29 acts 50 minutes ago leave the window in 10 minutes.
    expect(refused.retryAt?.getTime()).toBe(at.getTime() + 10 * 60_000);
    // Toggles have their own allowance.
    expect((await startToggle(member, boost(member.linkId), at, river)).status).toBe("unknown");
  });

  it("100 text acts a day, 50 follows a day, 30 deletes in 30 minutes, 120 toggles an hour", async () => {
    const at = new Date();
    const cases: Array<[string, string, number, number, ActInput["verb"]]> = [
      ["comment", "text", 100, 5 * 3_600_000, "reply"],
      ["follow", "follow", 50, 20 * 3_600_000, "unfollow"],
      ["delete", "delete", 30, 20 * 60_000, "delete"],
      ["favourite", "toggle", 120, 30 * 60_000, "unboost"],
    ];
    for (const [verb, kind, n, ago, next] of cases) {
      const member = await newMember();
      await history(member, verb, kind, n, at, ago);
      const refused = await refusedWith(startToggle(member, { ...boost(member.linkId), verb: next }, at, river));
      expect(refused.code, verb).toBe("limit");
    }
    // 599 toggles spread over the day leave one.
    const member = await newMember();
    await history(member, "boost", "toggle", 599, at, 3 * 3_600_000);
    await startToggle(member, boost(member.linkId), at, river);
    expect((await refusedWith(startToggle(member, boost(member.linkId), at, river))).code).toBe("limit");
  });

  it("two racing sends for the last allowance: one goes, one is refused", async () => {
    const member = await newMember();
    const at = new Date();
    await history(member, "post", "text", 29, at, 10 * 60_000);
    const a = await createPreview(member, post(member.linkId), at, river);
    const b = await createPreview(member, post(member.linkId), at, river);
    const results = await Promise.allSettled([claimPreview(member, a.id, at, river), claimPreview(member, b.id, at, river)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as ActRefused).code).toBe("limit");
  });
});

describe("sending a preview (ADR-010 §4, §10)", () => {
  it("a preview is sent once, and its outcome is recorded once", async () => {
    const member = await newMember();
    const at = new Date();
    const preview = await createPreview(member, post(member.linkId), at, river);
    expect(preview.status).toBe("previewed");
    const claimed = await claimPreview(member, preview.id, at, river);
    expect(claimed.request).toEqual(post(member.linkId).request);
    expect((await refusedWith(claimPreview(member, preview.id, at, river))).code).toBe("already_sent");
    const words = "<b>No</b> ".repeat(60);
    expect(
      await finishAct(member, preview.id, { status: "failed", errorCode: "422", errorMessage: words }, river),
    ).toBe(true);
    expect(await finishAct(member, preview.id, { status: "sent" }, river)).toBe(false);
    const row = await forAccount(
      SEED_INSTANCE,
      member.accountId,
      async (db) => (await db.query("SELECT status, error_message FROM river.member_actions WHERE id = $1", [preview.id])).rows[0],
      river,
    );
    expect(row.status).toBe("failed");
    expect(row.error_message).toBe(words.slice(0, 300));
  });

  it("a preview older than 15 minutes is refused", async () => {
    const member = await newMember();
    const at = new Date();
    const preview = await createPreview(member, post(member.linkId), new Date(at.getTime() - 16 * 60_000), river);
    expect((await refusedWith(claimPreview(member, preview.id, at, river))).code).toBe("preview_expired");
  });

  it("after Sign out everywhere, nothing previewed before can be sent, and the old session can't act (check 16)", async () => {
    const member = await newMember();
    const preview = await createPreview(member, post(member.linkId), new Date(), river);
    expect(await endAllSessions(SEED_INSTANCE, member.accountId, river)).toBe(2);
    // The old session's cookie carried epoch 1.
    expect((await refusedWith(claimPreview(member, preview.id, new Date(), river))).code).toBe("session_ended");
    expect((await refusedWith(startToggle(member, boost(member.linkId), new Date(), river))).code).toBe("session_ended");
    expect((await refusedWith(createPreview(member, post(member.linkId), new Date(), river))).code).toBe("session_ended");
    // A new session at epoch 2 can't send the old preview either.
    const fresh = { ...member, sessionEpoch: 2 };
    expect((await refusedWith(claimPreview(fresh, preview.id, new Date(), river))).code).toBe("session_ended");
    expect((await startToggle(fresh, boost(member.linkId), new Date(), river)).session_epoch).toBe(2);
  });

  it("another member's preview reads as not found; an unlinked account can't act", async () => {
    const member = await newMember();
    const other = await newMember();
    const preview = await createPreview(member, post(member.linkId), new Date(), river);
    expect((await refusedWith(claimPreview(other, preview.id, new Date(), river))).code).toBe("not_found");
    await forAccount(
      SEED_INSTANCE,
      member.accountId,
      (db) =>
        db.query(
          `UPDATE river.linked_accounts SET status = 'unlinked', token_ciphertext = NULL, token_dek = NULL,
                  token_key_version = NULL, revoked_at = now() WHERE id = $1`,
          [member.linkId],
        ),
      river,
    );
    expect((await refusedWith(claimPreview(member, preview.id, new Date(), river))).code).toBe("link_inactive");
    expect((await refusedWith(startToggle(member, boost(member.linkId), new Date(), river))).code).toBe("link_inactive");
    // Another member's link can't be used either.
    expect((await refusedWith(startToggle(other, boost(member.linkId), new Date(), river))).code).toBe("link_inactive");
  });
});
