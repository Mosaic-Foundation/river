// Your activity over HTTP (ADR-010 §7; GET /api/activity), against the running dev server. Members
// sign in through the River's real callback (helpers/member.ts). Their acts are written straight to
// the database as river_app, as the sending code will write them (src/river/acting/acts.ts), since
// nothing in the River sends yet. The member's account is found by DID as postgres (lookup only).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forAccount } from "../../../src/db/context.js";
import { ADMIN_URL, RIVER_URL, SEED_INSTANCE, rolePool } from "./roles.js";
import { API, DidLogServer, requireApi, type Member } from "../helpers/member.js";

const logs = new DidLogServer();
const river = rolePool(RIVER_URL);
const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });

beforeAll(async () => {
  await requireApi();
  await logs.start();
});

afterAll(async () => {
  await logs.close();
  await river.end();
  await admin.end();
});

async function accountOf(member: Member): Promise<string> {
  const { rows } = await admin.query<{ account_id: string }>("SELECT account_id FROM river.login_methods WHERE did = $1", [member.did]);
  if (!rows[0]) throw new Error("no account for this DID");
  return rows[0].account_id;
}

/** Writes acts for a member, oldest first, one minute apart, ending a minute ago. */
async function acts(accountId: string, rows: Array<Record<string, unknown>>): Promise<string[]> {
  const start = Date.now() - (rows.length + 1) * 60_000;
  return forAccount(
    SEED_INSTANCE,
    accountId,
    async (db) => {
      const ids: string[] = [];
      for (const [i, row] of rows.entries()) {
        const at = new Date(start + i * 60_000);
        const status = (row.status as string | undefined) ?? "sent";
        const inserted = await db.insert<{ id: string }>("member_actions", {
          channel: "fediverse",
          target_host: "example.social",
          target_label: "@ana@example.social",
          verb: "post",
          limit_kind: "text",
          session_epoch: 1,
          request: JSON.stringify({ method: "POST", url: "https://example.social/api/v1/statuses", fields: { status: "secret draft" } }),
          created_at: at,
          sent_at: status === "previewed" ? null : at,
          ...row,
          status,
        });
        ids.push(inserted.id);
      }
      return ids;
    },
    river,
  );
}

function get(member: Member | null, query = "") {
  return fetch(`${API}/activity${query}`, { headers: member ? { cookie: member.cookie } : {} });
}

describe("GET /api/activity", () => {
  it("is for members only", async () => {
    const res = await get(null);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("sign_in_required");
  });

  it("a new member's list is empty", async () => {
    const member = await logs.signIn();
    const res = await get(member);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ entries: [], nextCursor: null, viewer: { did: member.did } });
  });

  it("lists sent acts newest first, never previews, request bodies or another member's acts", async () => {
    const member = await logs.signIn();
    const other = await logs.signIn();
    const [failed, preview, sent, unsafe] = await acts(await accountOf(member), [
      { status: "failed", error_code: "422", error_message: "<b>Too long</b>" },
      { status: "previewed" },
      { status: "sent", remote_url: "https://example.social/@ana/1", subject_title: "A post", subject_url: "https://w3c.social/@w3c/9" },
      { status: "sent", verb: "boost", limit_kind: "toggle", remote_url: "javascript:alert(1)", subject_url: "http://plain.example/x" },
    ]);
    await acts(await accountOf(other), [{ status: "sent" }]);

    const body = await (await get(member)).json();
    const text = JSON.stringify(body);
    expect(body.entries.map((e: { id: string }) => e.id)).toEqual([unsafe, sent, failed]);
    expect(body.entries.map((e: { id: string }) => e.id)).not.toContain(preview);
    expect(text).not.toContain("secret draft");
    expect(text).not.toContain("request");
    expect(body.entries[1]).toMatchObject({
      verb: "post",
      status: "sent",
      targetHost: "example.social",
      targetLabel: "@ana@example.social",
      remoteUrl: "https://example.social/@ana/1",
      subjectTitle: "A post",
      subjectUrl: "https://w3c.social/@w3c/9",
    });
    // Only https becomes a link.
    expect(body.entries[0]).toMatchObject({ verb: "boost", remoteUrl: null, subjectUrl: null });
    // The other side's words come back as given; the page shows them as text.
    expect(body.entries[2]).toMatchObject({ status: "failed", errorCode: "422", errorMessage: "<b>Too long</b>" });
  });

  it("pages 50 at a time with a cursor; a bad cursor is a 400", async () => {
    const member = await logs.signIn();
    const ids = await acts(await accountOf(member), Array.from({ length: 53 }, () => ({ verb: "favourite", limit_kind: "toggle" })));
    const first = await (await get(member)).json();
    expect(first.entries).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await (await get(member, `?cursor=${encodeURIComponent(first.nextCursor)}`)).json();
    expect(second.nextCursor).toBeNull();
    const seen = [...first.entries, ...second.entries].map((e: { id: string }) => e.id);
    expect(seen).toEqual([...ids].reverse());

    for (const query of ["?cursor=nonsense", `?cursor=${Buffer.from(`2026-01-01T00:00:00.000Z|${randomUUID()}|x`).toString("base64url")}`, "?cursor=a&cursor=b"]) {
      const res = await get(member, query);
      expect(res.status, query).toBe(400);
      expect((await res.json()).error).toBe("bad_cursor");
    }
  });
});
