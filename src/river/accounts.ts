// Members' accounts (spec 3.1, F2, F3): found or created by (instance, kind 'did', SCID), never by
// email (the River never receives one; constraint 7). On first sign-in the instance's seed follows
// and default circles, the civic-role circle included, are copied into the member's own rows.
//
// A seed name whose space isn't stored yet (nobody has opened this River since the instance was
// seeded) can't be copied as a row, so it waits in the member's `seed_pending` preference; the
// member's first feed resolves it and copies it then (feed/member.ts). Nothing is dropped.
import { randomUUID } from "node:crypto";
import { forAccount, forInstance, type ClientSource, type Db, type RiverDb } from "../db/context.js";
import { findSpaces } from "./feed/spaces.js";
import { hasFollowOrigin, originValues, SEED } from "./following/origin.js";
import type { Instance } from "./instances.js";

export const SEED_PENDING_KEY = "seed_pending";

/** A seed name waiting for its space: follow it, and add it to these circles (by id). */
export interface PendingSeed {
  url: string;
  stream_key?: string;
  follow: boolean;
  circleIds: string[];
}

export interface SignedInAccount {
  accountId: string;
  created: boolean;
  /** The account's session epoch, for the new session cookie. */
  sessionEpoch: number;
}

// Session revocation (migration 20261026201500_session_epoch, DECISIONS 2026-10-26): each account
// has a session epoch, which every session cookie carries and "Sign out everywhere" raises. The
// code may deploy before the migration lands (CLAUDE.md "Database"); until then every account reads
// as epoch 1, the column's default, so sessions issued meanwhile stay good once it lands. The check
// is one information_schema read per process once it answers yes, and at most once a minute before.
const RECHECK_MS = 60_000;
let epochKnown: boolean | undefined;
let epochCheckedAt = 0;

/** Whether river.accounts has session_epoch yet. */
export async function hasSessionEpoch(db: Db, now: number = Date.now()): Promise<boolean> {
  if (epochKnown === true) return true;
  if (epochKnown === false && now - epochCheckedAt < RECHECK_MS) return false;
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'river' AND table_name = 'accounts' AND column_name = 'session_epoch'`,
  );
  epochKnown = rows.length > 0;
  epochCheckedAt = now;
  return epochKnown;
}

/** Forgets the answer (tests). */
export function resetSessionEpochCheck(): void {
  epochKnown = undefined;
  epochCheckedAt = 0;
}

/** The account in context's session epoch (1 before the column exists). */
async function sessionEpoch(db: Db, accountId: string): Promise<number> {
  if (!(await hasSessionEpoch(db))) return 1;
  const { rows } = await db.query<{ session_epoch: number }>("SELECT session_epoch FROM river.accounts WHERE id = $1", [accountId]);
  if (!rows[0]) throw new Error("account vanished during sign-in");
  return rows[0].session_epoch;
}

/**
 * "Sign out everywhere": raises the account's session epoch, so every session cookie issued before
 * now reads as a visitor. Returns the new epoch, or undefined before the column exists.
 */
export async function endAllSessions(instanceId: string, accountId: string, source?: ClientSource): Promise<number | undefined> {
  return forAccount(
    instanceId,
    accountId,
    async (db) => {
      if (!(await hasSessionEpoch(db))) return undefined;
      const { rows } = await db.query<{ session_epoch: number }>(
        "UPDATE river.accounts SET session_epoch = session_epoch + 1 WHERE id = $1 RETURNING session_epoch",
        [accountId],
      );
      return rows[0]?.session_epoch;
    },
    source,
  );
}

/** The account holding this DID's login method on this instance, created on first sign-in. */
export async function signInAccount(
  instance: Instance,
  login: { did: string; scid: string },
  source?: ClientSource,
): Promise<SignedInAccount> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await forInstance(
      instance.id,
      async (db) => (await db.query<{ id: string | null }>("SELECT river.account_for_login('did', $1) AS id", [login.scid])).rows[0]?.id,
      source,
    );
    if (existing) {
      // The DID may have moved host since (same SCID); the stored DID follows it.
      const epoch = await forAccount(
        instance.id,
        existing,
        async (db) => {
          await db.query("UPDATE river.login_methods SET did = $1, last_used_at = now() WHERE kind = 'did' AND scid = $2", [
            login.did,
            login.scid,
          ]);
          return sessionEpoch(db, existing);
        },
        source,
      );
      return { accountId: existing, created: false, sessionEpoch: epoch };
    }
    const accountId = randomUUID();
    try {
      const epoch = await forAccount(
        instance.id,
        accountId,
        async (db) => {
          await db.insert("accounts", { id: accountId });
          await db.insert("login_methods", { kind: "did", did: login.did, scid: login.scid });
          await copySeeds(db, instance);
          return sessionEpoch(db, accountId);
        },
        source,
      );
      return { accountId, created: true, sessionEpoch: epoch };
    } catch (err) {
      // Two first sign-ins of one DID at once: the other made the account; use it.
      if ((err as { code?: string }).code === "23505" && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("Could not find or create the account");
}

/** Every name the instance's seeds mention: follows and circle members. */
function seedNames(instance: Instance): string[] {
  return [...new Set([...instance.seedFollows.map((f) => f.url), ...instance.defaultCircles.flatMap((c) => c.members)])];
}

async function streamId(db: Db, spaceId: string, key: string): Promise<string> {
  await db.query("INSERT INTO river.streams (space_id, key) VALUES ($1, $2) ON CONFLICT (space_id, key) DO NOTHING", [
    spaceId,
    key,
  ]);
  const { rows } = await db.query<{ id: string }>("SELECT id FROM river.streams WHERE space_id = $1 AND key = $2", [
    spaceId,
    key,
  ]);
  if (!rows[0]) throw new Error("stream vanished between insert and select");
  return rows[0].id;
}

/** A seed follow (the sign-up copy, or one waiting for its space): origin seed once the column exists. */
async function follow(db: Db, spaceId: string, streamKey: string | undefined): Promise<void> {
  const stream = streamKey ? await streamId(db, spaceId, streamKey) : null;
  if (await hasFollowOrigin(db)) {
    await db.query(
      `INSERT INTO river.follows (space_id, stream_id, origin, origin_ref, origin_label) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, space_id, stream_id) DO NOTHING`,
      [spaceId, stream, ...originValues(SEED)],
    );
    return;
  }
  await db.query(
    "INSERT INTO river.follows (space_id, stream_id) VALUES ($1, $2) ON CONFLICT (account_id, space_id, stream_id) DO NOTHING",
    [spaceId, stream],
  );
}

async function addToCircle(db: Db, circleId: string, spaceId: string): Promise<void> {
  await db.query(
    "INSERT INTO river.circle_members (circle_id, space_id) VALUES ($1, $2) ON CONFLICT (circle_id, space_id) DO NOTHING",
    [circleId, spaceId],
  );
}

/** Copies the instance's seed follows and default circles into a new member's rows. */
export async function copySeeds(db: RiverDb, instance: Instance): Promise<void> {
  const spaces = await findSpaces(db, seedNames(instance));
  const pending = new Map<string, PendingSeed>();
  const pendingFor = (url: string): PendingSeed => {
    const entry = pending.get(url) ?? { url, follow: false, circleIds: [] };
    pending.set(url, entry);
    return entry;
  };

  for (const seed of instance.seedFollows) {
    const space = spaces.get(seed.url);
    if (space) await follow(db, space.id, seed.stream_key);
    else Object.assign(pendingFor(seed.url), { follow: true, ...(seed.stream_key ? { stream_key: seed.stream_key } : {}) });
  }

  for (const [sort, circle] of instance.defaultCircles.entries()) {
    const row = await db.insert<{ id: string }>("circles", {
      name: circle.name,
      color: circle.color ?? null,
      role: circle.role === "civic" ? "civic" : null,
      sort,
    });
    for (const member of circle.members) {
      const space = spaces.get(member);
      if (space) await addToCircle(db, row.id, space.id);
      else pendingFor(member).circleIds.push(row.id);
    }
  }

  if (pending.size > 0) {
    await db.insert("preferences", { key: SEED_PENDING_KEY, value: JSON.stringify([...pending.values()]) });
  }
}

function isPendingSeed(value: unknown): value is PendingSeed {
  const v = value as PendingSeed;
  return Boolean(v) && typeof v.url === "string" && typeof v.follow === "boolean" && Array.isArray(v.circleIds);
}

/**
 * Copies the seeds that were waiting for a space and now have one; returns the names still
 * waiting, which the caller resolves (they appear on a later open). Runs inside forAccount().
 */
export async function applyPendingSeeds(db: Db): Promise<string[]> {
  const { rows } = await db.query<{ value: unknown }>("SELECT value FROM river.preferences WHERE key = $1", [SEED_PENDING_KEY]);
  if (!rows[0]) return [];
  const waiting = Array.isArray(rows[0].value) ? rows[0].value.filter(isPendingSeed) : [];
  const spaces = await findSpaces(db, waiting.map((p) => p.url));
  const { rows: circles } = await db.query<{ id: string }>("SELECT id FROM river.circles");
  const ownCircles = new Set(circles.map((c) => c.id));
  const still: PendingSeed[] = [];
  for (const entry of waiting) {
    const space = spaces.get(entry.url);
    if (!space) {
      still.push(entry);
      continue;
    }
    if (entry.follow) await follow(db, space.id, entry.stream_key);
    for (const circleId of entry.circleIds) if (ownCircles.has(circleId)) await addToCircle(db, circleId, space.id);
  }
  if (still.length === 0) {
    await db.query("DELETE FROM river.preferences WHERE key = $1", [SEED_PENDING_KEY]);
  } else if (still.length !== waiting.length) {
    await db.query("UPDATE river.preferences SET value = $2::jsonb WHERE key = $1", [SEED_PENDING_KEY, JSON.stringify(still)]);
  }
  return still.map((p) => p.url);
}

/** Who is signed in, for the UI: the account's name and the DID it last signed in with. */
export interface Viewer {
  accountId: string;
  displayName: string | null;
  did: string | null;
  /** The account's session epoch; a session cookie must carry this one (never sent to the UI). */
  sessionEpoch: number;
}

/** The member's own account row, or undefined when it no longer exists. */
export async function loadViewer(
  instanceId: string,
  accountId: string,
  source?: ClientSource,
): Promise<Viewer | undefined> {
  const { rows } = await forAccount(
    instanceId,
    accountId,
    async (db) => {
      const epoch = (await hasSessionEpoch(db)) ? "a.session_epoch" : "1";
      return db.query<{ id: string; display_name: string | null; did: string | null; session_epoch: number }>(
        // Row security already limits this to the account in context; the WHERE says so too, so
        // a looser policy or another role could never hand back someone else's account.
        `SELECT a.id, a.display_name, ${epoch} AS session_epoch,
                (SELECT lm.did FROM river.login_methods lm WHERE lm.account_id = a.id
                  ORDER BY lm.last_used_at DESC LIMIT 1) AS did
           FROM river.accounts a
          WHERE a.id = $1`,
        [accountId],
      );
    },
    source,
  );
  const row = rows[0];
  return row ? { accountId: row.id, displayName: row.display_name, did: row.did, sessionEpoch: row.session_epoch } : undefined;
}
