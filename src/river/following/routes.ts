// The follow box, the Following page and circles (spec F6, F7, F8), members only. Mounted inside
// riverRoutes(), after checkOrigin(): every state-changing request carries the River's Origin
// (Appendix B). Each handler runs its statements inside forAccount() for the signed-in member.
//
//   POST   /follow/preview                 { input }                  → { preview }
//   POST   /follows                        { input, scope, circleIds } → { spaceId, streamId, refresh }
//   POST   /follow/bluesky/preview         { input }                  → { account, count, accounts, … }
//   POST   /follow/bluesky/import          { input, circleIds }       → { total, followed, alreadyFollowing, … }
//   GET    /following                                                 → FollowingPage
//   DELETE /following/spaces/:spaceId                                  unfollow a space
//   PUT    /following/streams/:streamId    { rule: follow | mute }     a stream rule
//   DELETE /following/rules/:ruleId                                    unmute, unfollow a stream, clear Ended
//   POST   /following/quiet/unfollow                                   "Unfollow all quiet spaces"
//   POST   /circles                        { name, color }
//   PATCH  /circles/:id                    { name?, color? }
//   DELETE /circles/:id
//   PUT    /circles/:id/spaces/:spaceId
//   DELETE /circles/:id/spaces/:spaceId
//
// Visitors get 401 "sign_in_required"; the UI shows them a sign-up prompt instead.
import { Router, type NextFunction, type Request, type Response } from "express";
import { forAccount, type RiverDb } from "../../db/context.js";
import { getFetchGuard } from "../../shared/fetch/index.js";
import { AdapterError } from "../../shared/items/index.js";
import { previewForAccount, readFollows, type FollowsListing } from "../adapters/bluesky/index.js";
import type { Viewer } from "../accounts.js";
import { readSession, requireMember } from "../auth/session.js";
import { riverNow } from "../clock.js";
import { refreshSpaces, type RefreshDeps } from "../feed/refresh.js";
import { upsertSpaces } from "../feed/store.js";
import { requireInstance, type Instance } from "../instances.js";
import { addCircleMember, createCircle, deleteCircle, removeCircleMember, updateCircle } from "./circles.js";
import { followErrorMessage, previewView, resolveInput } from "./resolve.js";
import {
  FollowingError,
  followingPage,
  followPreview,
  followSpaces,
  isUuid,
  removeRule,
  setStreamRule,
  unfollowQuiet,
  unfollowSpace,
  type FollowRequest,
} from "./service.js";

/** Most circles one follow can add the space to. */
const MAX_CIRCLE_IDS = 50;
/** Accounts the import preview lists by name (the rest are counted). */
const IMPORT_PREVIEW_NAMES = 12;

/** What the import preview shows (docs/spec/bluesky-1.md item 4): who, how many, the first names. */
function importView(listing: FollowsListing) {
  const { account, accounts } = listing;
  return {
    account: { did: account.did, name: account.name, handle: account.handle ?? null, iconUrl: account.iconUrl ?? null },
    count: accounts.length,
    skipped: listing.skipped,
    truncated: listing.truncated,
    accounts: accounts
      .slice(0, IMPORT_PREVIEW_NAMES)
      .map((a) => ({ did: a.did, name: a.name, handle: a.handle ?? null, iconUrl: a.iconUrl ?? null })),
  };
}

/** The handle, profile URL or DID typed in the import box. */
function importInput(raw: Record<string, unknown>): string {
  const input = typeof raw.input === "string" ? raw.input.trim() : "";
  if (input === "" || input.length > 500) throw new AdapterError("not_a_space", "That address isn't a Space we can follow");
  return input;
}

function member(res: Response): { instance: Instance; viewer: Viewer } {
  return { instance: res.locals.instance as Instance, viewer: res.locals.viewer as Viewer };
}

function inAccount<T>(res: Response, fn: (db: RiverDb) => Promise<T>): Promise<T> {
  const { instance, viewer } = member(res);
  return forAccount(instance.id, viewer.accountId, fn);
}

/** A path parameter that must be a uuid, lowercased; a 404 otherwise. */
function idParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!isUuid(value)) throw new FollowingError(404, "not_found", "Not found.");
  return value.toLowerCase();
}

function body(req: Request): Record<string, unknown> {
  const value: unknown = req.body;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseFollowRequest(raw: Record<string, unknown>): FollowRequest {
  const scope = raw.scope === undefined ? "space" : raw.scope;
  if (scope !== "space" && scope !== "stream") throw new FollowingError(400, "bad_scope", "Choose a stream or the whole space.");
  const ids = raw.circleIds === undefined ? [] : raw.circleIds;
  if (!Array.isArray(ids) || ids.length > MAX_CIRCLE_IDS || !ids.every(isUuid)) {
    throw new FollowingError(400, "bad_circles", "Those circles aren't yours.");
  }
  return { scope, circleIds: [...new Set(ids.map((id) => id.toLowerCase()))] };
}

function handle(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof FollowingError) {
    res.status(err.status).set("Cache-Control", "no-store").json({ error: err.code, message: err.message });
    return;
  }
  if (err instanceof AdapterError) {
    // The follow box's sentences (spec F6), never the adapter's detail.
    const { reason, message } = followErrorMessage(err);
    res.status(422).set("Cache-Control", "no-store").json({ error: reason, message });
    return;
  }
  next(err);
}

type Handler = (req: Request, res: Response) => Promise<void>;

function route(fn: Handler) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      handle(err, res, next);
    }
  };
}

export function followingRoutes(deps: RefreshDeps = {}): Router {
  const router = Router();
  const members = [requireInstance(), readSession(), requireMember()];

  // The preview (spec F6): resolves through the adapters and the fetch guard; stores nothing.
  // A POST so a page elsewhere can't make the River fetch addresses (Origin is checked).
  router.post(
    "/follow/preview",
    ...members,
    route(async (req, res) => {
      const preview = await resolveInput(String(body(req).input ?? ""), { guard: deps.guard, now: deps.now });
      res.set("Cache-Control", "no-store").json({ preview: previewView(preview) });
    }),
  );

  // Confirm: resolve again (the preview stored nothing), store the follow, then refresh the space
  // through the same path the feed uses (spec 4.5), within its budget.
  router.post(
    "/follows",
    ...members,
    route(async (req, res) => {
      const raw = body(req);
      const request = parseFollowRequest(raw);
      const preview = await resolveInput(String(raw.input ?? ""), { guard: deps.guard, now: deps.now });
      const result = await inAccount(res, (db) => followPreview(db, preview, request));
      const refresh = await refreshSpaces(member(res).instance.id, [result.space], deps);
      res
        .status(201)
        .set("Cache-Control", "no-store")
        .json({
          spaceId: result.space.id,
          streamId: result.streamId,
          ruleId: result.ruleId,
          refresh: { claimed: refresh.claimed, pending: refresh.pending },
        });
    }),
  );

  // "Import from Bluesky" (docs/spec/bluesky-1.md item 4): who the account follows, counted.
  router.post(
    "/follow/bluesky/preview",
    ...members,
    route(async (req, res) => {
      const listing = await readFollows(deps.guard ?? getFetchGuard(), importInput(body(req)));
      res.set("Cache-Control", "no-store").json(importView(listing));
    }),
  );

  // Follow them all: read the list again (the preview stored nothing), store the spaces and the
  // follows in a few statements, then refresh the first few within the feed's budget; the rest
  // fill in over the next opens (rotation.ts).
  router.post(
    "/follow/bluesky/import",
    ...members,
    route(async (req, res) => {
      const raw = body(req);
      const { circleIds } = parseFollowRequest({ circleIds: raw.circleIds });
      const listing = await readFollows(deps.guard ?? getFetchGuard(), importInput(raw));
      const now = deps.now ?? riverNow();
      const previews = listing.accounts.map((a) => previewForAccount(a, now));
      const { spaces, followed } = await inAccount(res, async (db) => {
        const rows = await upsertSpaces(db, previews);
        return { spaces: rows, followed: await followSpaces(db, rows.map((r) => r.id), circleIds) };
      });
      const refresh = await refreshSpaces(member(res).instance.id, spaces, deps);
      res
        .status(201)
        .set("Cache-Control", "no-store")
        .json({
          total: spaces.length,
          followed,
          alreadyFollowing: spaces.length - followed,
          skipped: listing.skipped,
          truncated: listing.truncated,
          refresh: { claimed: refresh.claimed, pending: refresh.pending },
        });
    }),
  );

  router.get(
    "/following",
    ...members,
    route(async (_req, res) => {
      const page = await inAccount(res, (db) => followingPage(db, deps.now ?? riverNow()));
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.delete(
    "/following/spaces/:spaceId",
    ...members,
    route(async (req, res) => {
      const spaceId = idParam(req, "spaceId");
      await inAccount(res, (db) => unfollowSpace(db, spaceId));
      res.status(204).set("Cache-Control", "no-store").end();
    }),
  );

  router.put(
    "/following/streams/:streamId",
    ...members,
    route(async (req, res) => {
      const streamId = idParam(req, "streamId");
      const rule = body(req).rule;
      if (rule !== "follow" && rule !== "mute") throw new FollowingError(400, "bad_rule", "Follow or mute the stream.");
      const result = await inAccount(res, (db) => setStreamRule(db, streamId, rule));
      res.set("Cache-Control", "no-store").json(result);
    }),
  );

  router.delete(
    "/following/rules/:ruleId",
    ...members,
    route(async (req, res) => {
      const ruleId = idParam(req, "ruleId");
      await inAccount(res, (db) => removeRule(db, ruleId));
      res.status(204).set("Cache-Control", "no-store").end();
    }),
  );

  router.post(
    "/following/quiet/unfollow",
    ...members,
    route(async (_req, res) => {
      const unfollowed = await inAccount(res, (db) => unfollowQuiet(db, deps.now ?? riverNow()));
      res.set("Cache-Control", "no-store").json({ unfollowed });
    }),
  );

  router.post(
    "/circles",
    ...members,
    route(async (req, res) => {
      const raw = body(req);
      const circle = await inAccount(res, (db) => createCircle(db, { name: raw.name, color: raw.color }));
      res.status(201).set("Cache-Control", "no-store").json({ circle });
    }),
  );

  router.patch(
    "/circles/:id",
    ...members,
    route(async (req, res) => {
      const id = idParam(req, "id");
      const raw = body(req);
      const circle = await inAccount(res, (db) => updateCircle(db, id, { name: raw.name, color: raw.color }));
      res.set("Cache-Control", "no-store").json({ circle });
    }),
  );

  router.delete(
    "/circles/:id",
    ...members,
    route(async (req, res) => {
      const id = idParam(req, "id");
      await inAccount(res, (db) => deleteCircle(db, id));
      res.status(204).set("Cache-Control", "no-store").end();
    }),
  );

  router.put(
    "/circles/:id/spaces/:spaceId",
    ...members,
    route(async (req, res) => {
      const id = idParam(req, "id");
      const spaceId = idParam(req, "spaceId");
      await inAccount(res, (db) => addCircleMember(db, id, spaceId));
      res.status(204).set("Cache-Control", "no-store").end();
    }),
  );

  router.delete(
    "/circles/:id/spaces/:spaceId",
    ...members,
    route(async (req, res) => {
      const id = idParam(req, "id");
      const spaceId = idParam(req, "spaceId");
      await inAccount(res, (db) => removeCircleMember(db, id, spaceId));
      res.status(204).set("Cache-Control", "no-store").end();
    }),
  );

  return router;
}
