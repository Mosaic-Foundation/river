// Posting recorder (fediverse-posting-1 item 9, A5): the GET requests the River makes before it
// posts, boosts or follows as a linked Mastodon account, recorded from Adam's test account on
// mastodon.social. Run only on Adam's machine, with the account's read-only token in the shell
// for that one command:
//
//   RECORD_MASTODON_TOKEN=… npm run record-fixtures -- --fediverse-post @{handle}@mastodon.social
//
// It sends the same requests as the River's own code, through the fetch guard: WebFinger,
// NodeInfo, the OAuth discovery document and /api/v2/instance through findAccount and checkServer
// (no token); then, with the token, verify_credentials, `search` with resolve=true for the
// account's own newest post and for a seed post, `search` for the seed account, and
// `relationships` for it. It writes nothing until it has everything, and then only if no body or
// header holds the token or anything else that looks like a credential (secretScan.ts). The
// Authorization header is never part of a fixture. Nothing is posted, favourited or followed.
import fs from "node:fs";
import path from "node:path";
import { env } from "../../src/config/env.js";
import { checkServer, findAccount } from "../../src/river/acting/fediverse/server.js";
import { verifyCredentials } from "../../src/river/acting/fediverse/oauth.js";
import {
  createFetchGuard,
  fixtureFromResponse,
  saveFixture,
  type FetchGuard,
  type FetchGuardOptions,
  type HttpFixture,
} from "../../src/shared/fetch/index.js";
import { secretsIn } from "./secretScan.js";

/** The seed account the test account follows (item 9.1), and where its recorded outbox is. */
export const SEED_ACTOR = "https://w3c.social/users/w3c";
const SEED_OUTBOX_DIR = "w3c.social";

/** The only host this recorder reaches: the test account's server. */
const HOSTS: ReadonlySet<string> = new Set(["mastodon.social"]);

/** For the recorder's unit test, which runs it against the stand-in server; unset on Adam's machine. */
export interface FediversePostOptions {
  guardOptions?: FetchGuardOptions;
  hosts?: ReadonlySet<string>;
  token?: string;
  /** Where the recorded w3c outbox is (default: the directory being written). */
  seedFixturesDir?: string;
}

/** Reads `--fediverse-post @name@mastodon.social` from the arguments; undefined when absent. */
export function fediversePostHandle(args: readonly string[]): string | undefined {
  const at = args.indexOf("--fediverse-post");
  if (at === -1) return undefined;
  const handle = args[at + 1];
  if (!handle || !/^@?[A-Za-z0-9_]+@mastodon\.social$/.test(handle)) {
    throw new Error("Usage: --fediverse-post @name@mastodon.social (the test account on mastodon.social)");
  }
  return handle.startsWith("@") ? handle : `@${handle}`;
}

/** A guard that only reaches HOSTS and keeps every answer in memory, never the request headers. */
function holdingGuard(held: HttpFixture[], hosts: ReadonlySet<string>, options?: FetchGuardOptions): FetchGuard {
  const inner = createFetchGuard(options);
  return {
    async fetch(url, init = {}) {
      const host = new URL(url).host.toLowerCase();
      if (!hosts.has(host)) throw new Error(`Not the test account's server, not recorded: ${host}`);
      const res = await inner.fetch(url, init);
      held.push(await fixtureFromResponse(res.clone(), { url, method: init.method }));
      return res;
    },
  };
}

/** The newest original post in the recorded w3c outbox, so the search answer matches a replayed feed. */
export function seedPostUri(fixturesDir: string): string {
  const dir = path.join(fixturesDir, SEED_OUTBOX_DIR);
  const pages = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("get_users_w3c_outbox_") && f.includes("page_true"))
    .sort();
  for (const file of pages) {
    const body = JSON.parse((JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as HttpFixture).body) as {
      orderedItems?: Array<{ type?: string; object?: unknown }>;
    };
    for (const activity of body.orderedItems ?? []) {
      const object = activity.object;
      const id = typeof object === "string" ? object : (object as { id?: unknown } | undefined)?.id;
      if (activity.type === "Create" && typeof id === "string" && id.startsWith(`${SEED_ACTOR}/statuses/`)) return id;
    }
  }
  throw new Error(`No recorded post from ${SEED_ACTOR} under ${dir}; record the seed accounts first.`);
}

async function getJson(guard: FetchGuard, url: string, token?: string): Promise<unknown> {
  const res = await guard.fetch(url, {
    headers: { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    redirect: "error",
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${new URL(url).pathname}: HTTP ${res.status}`);
  return JSON.parse(text) as unknown;
}

/** The same URL the River's searchOnServer builds (src/river/acting/fediverse/posts.ts). */
function searchUrl(host: string, q: string, type: "statuses" | "accounts"): string {
  const url = new URL(`https://${host}/api/v2/search`);
  url.search = new URLSearchParams({ q, resolve: "true", type, limit: "1" }).toString();
  return url.toString();
}

function firstId(body: unknown, key: "statuses" | "accounts"): string {
  const list = (body as Record<string, unknown> | null)?.[key];
  const id = Array.isArray(list) ? (list[0] as { id?: unknown } | undefined)?.id : undefined;
  if (typeof id !== "string") throw new Error(`search found no ${key.slice(0, -1)}`);
  return id;
}

export function fediversePostRecorder(handle: string, options: FediversePostOptions = {}) {
  return {
    name: `fediverse posting: ${handle}`,
    async record(outDir: string): Promise<string[]> {
      const token = options.token ?? env.recordMastodonToken;
      if (!token) throw new Error("Set RECORD_MASTODON_TOKEN in the shell for this one command (fediverse-posting-1 item 9.3).");
      const held: HttpFixture[] = [];
      const guard = holdingGuard(held, options.hosts ?? HOSTS, options.guardOptions);

      // Linking: WebFinger, NodeInfo, discovery and the instance, as Check does (no token).
      const named = await findAccount(guard, handle);
      const server = await checkServer(guard, named.host);
      console.log(`  ${named.handle}: ${server.software} ${server.version}, ${server.maxCharacters} characters`);

      // The account, as the callback and the composer read it.
      const account = await verifyCredentials(guard, named.host, token);
      const accountId = typeof account.id === "string" ? account.id : undefined;
      if (!accountId) throw new Error("verify_credentials gave no account id");

      // Its own newest post (public, no token), then that post and a seed post through search.
      const own = await getJson(guard, `https://${named.host}/api/v1/accounts/${encodeURIComponent(accountId)}/statuses?limit=1&exclude_replies=true&exclude_reblogs=true`);
      const ownUri = Array.isArray(own) ? (own[0] as { uri?: unknown } | undefined)?.uri : undefined;
      if (typeof ownUri !== "string") throw new Error("The test account has no post of its own yet (item 9.1).");
      firstId(await getJson(guard, searchUrl(named.host, ownUri, "statuses"), token), "statuses");
      firstId(await getJson(guard, searchUrl(named.host, seedPostUri(options.seedFixturesDir ?? outDir), "statuses"), token), "statuses");

      // The seed account and the test account's relationship with it (it follows @w3c, item 9.1).
      const seedId = firstId(await getJson(guard, searchUrl(named.host, SEED_ACTOR, "accounts"), token), "accounts");
      const rel = new URL(`https://${named.host}/api/v1/accounts/relationships`);
      rel.searchParams.append("id[]", seedId);
      await getJson(guard, rel.toString(), token);

      // Nothing is written unless every answer is clean.
      const problems = held.flatMap((f) => secretsIn(f, token).map((p) => `${new URL(f.url).pathname}: ${p}`));
      if (problems.length > 0) {
        throw new Error(`Nothing was written. These answers hold something like a credential:\n  ${problems.join("\n  ")}`);
      }
      return held.map((f) => saveFixture(outDir, f));
    },
  };
}
