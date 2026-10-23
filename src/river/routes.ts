// River API routes (spec 2, 4.5, 4.6). Mounted by createApp("river") only; River code never
// imports src/identity/ (CLAUDE.md constraint 7). Paths here are what the browser sees after /api/
// (the dev proxy and api/index.ts both strip the prefix).
//
// Every state-changing request (anything but GET/HEAD/OPTIONS) must carry Origin =
// RIVER_PUBLIC_ORIGIN (Appendix B). Visitors make none: their read state stays in the browser
// (check 23); members' read state is written here.
import { Router, type NextFunction, type Request, type Response } from "express";
import { env } from "../config/env.js";
import { forAccount } from "../db/context.js";
import type { Viewer } from "./accounts.js";
import { authRoutes } from "./auth/routes.js";
import { checkOrigin, readSession, requireMember } from "./auth/session.js";
import { memberExport } from "./export/index.js";
import { FeedInputError, memberFeed, memberMarkAllRead, readerItem, visitorFeed, type FeedParams } from "./feed/index.js";
import { checkFraming } from "./frame/check.js";
import { followingRoutes } from "./following/routes.js";
import { requireInstance, type Instance } from "./instances.js";

/** A query parameter as one string; repeated or nested values are refused, not guessed at. */
function param(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FeedInputError(name as FeedInputError["field"], `${name} must be given once`);
  return value;
}

/**
 * A query parameter that may repeat (`circle=a&circle=b`, ui-revisions-4 item 1). Repeating keeps
 * circle names (visitors' circles are named by name) free to hold commas.
 */
function paramList(req: Request, name: string): string[] | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : typeof value === "object" ? indexed(value) : [value];
  if (!values.every((v): v is string => typeof v === "string")) {
    throw new FeedInputError(name as FeedInputError["field"], `${name} must be text`);
  }
  return values;
}

/**
 * Express's query parser (qs) returns more than 20 repeats of a key as an object keyed "0", "1", ...
 * rather than an array. Those keys, in order, are the list; any other key is a malformed request.
 */
function indexed(value: object): unknown[] {
  const entries = Object.entries(value);
  if (!entries.every(([key]) => /^\d+$/.test(key))) return [value];
  return entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, v]) => v);
}

/** A field of a JSON body that holds one string or a list of them (circles). */
function bodyParamList(body: unknown, name: keyof FeedParams): string[] | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  if (value === undefined || value === null) return undefined;
  const values = Array.isArray(value) ? (value as unknown[]) : [value];
  if (!values.every((v): v is string => typeof v === "string")) {
    throw new FeedInputError(name as FeedInputError["field"], `${name} must be a string or a list of strings`);
  }
  return values;
}

/** A string field of a JSON body, for the view parameters "Mark all read" takes. */
function bodyParam(body: unknown, name: keyof FeedParams): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new FeedInputError(name as FeedInputError["field"], `${name} must be a string`);
  return value;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const READ_BATCH_LIMIT = 500;

/** A list of item ids from a JSON body, or undefined when it isn't one. */
function itemIds(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > READ_BATCH_LIMIT) return undefined;
  const ids = value.map((v) => (typeof v === "string" ? v.toLowerCase() : ""));
  return ids.every((id) => UUID.test(id)) ? [...new Set(ids)] : undefined;
}

function feedError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof FeedInputError) {
    res.status(400).json({ error: `bad_${err.field}`, message: err.message });
    return;
  }
  next(err);
}

export function riverRoutes(): Router {
  const router = Router();

  router.use(checkOrigin());

  // Says which app answered, for checking a deployment. Needs no database.
  router.get("/", (_req, res) => {
    res.json({ app: "river", name: "Mosaic River" });
  });

  router.use(authRoutes());

  // The follow box, the Following page and circles (spec F6, F7, F8): members only.
  router.use(followingRoutes());

  // The feed (spec 4.5): a visitor's (seed follows; writes nothing but the refresh's source data,
  // check 23) or a signed-in member's (their own follows, circles and read state).
  router.get("/feed", requireInstance(), readSession(), async (req, res, next) => {
    try {
      const params: FeedParams = {
        mode: param(req, "mode"),
        circle: paramList(req, "circle"),
        type: param(req, "type"),
        network: param(req, "network"),
        q: param(req, "q"),
        cursor: param(req, "cursor"),
      };
      const instance = res.locals.instance as Instance;
      const viewer = res.locals.viewer as Viewer | undefined;
      const feed = viewer ? await memberFeed(instance, viewer, params) : await visitorFeed(instance, params);
      res.set("Cache-Control", "no-store").json(feed);
    } catch (err) {
      feedError(err, res, next);
    }
  });

  // One stored item for the reader view (ui-revisions-1 item 1), from what the reader follows.
  // Fetches nothing from outside. 404 for an item that isn't there or isn't the reader's to see.
  router.get("/items/:id", requireInstance(), readSession(), async (req, res, next) => {
    try {
      const item = await readerItem(res.locals.instance as Instance, res.locals.viewer as Viewer | undefined, String(req.params.id));
      if (!item) {
        res.status(404).set("Cache-Control", "no-store").json({ error: "not_found", message: "This item isn't in your River." });
        return;
      }
      res.set("Cache-Control", "no-store").json({ item });
    } catch (err) {
      feedError(err, res, next);
    }
  });

  // Whether an item's page can be shown in the embedded view (ui-revisions-2 item 2,
  // ui-revisions-3 item 2, ADR-008), asked as its card comes into view: one guarded request for
  // the stored item's own URL, read for its framing headers. { frame: { url } } frames that URL;
  // { frame: null } opens the original in a new tab. Only items the
  // reader can see are checked, so this can't be pointed at any other address.
  router.get("/items/:id/frame", requireInstance(), readSession(), async (req, res, next) => {
    try {
      const item = await readerItem(res.locals.instance as Instance, res.locals.viewer as Viewer | undefined, String(req.params.id));
      if (!item) {
        res.status(404).set("Cache-Control", "no-store").json({ error: "not_found", message: "This item isn't in your River." });
        return;
      }
      const answer = item.source === "live" && item.url?.startsWith("https://")
        ? await checkFraming(item.url, env.riverPublicOrigin)
        : undefined;
      res.set("Cache-Control", "no-store").json({ frame: answer?.frame ? { url: answer.url } : null });
    } catch (err) {
      feedError(err, res, next);
    }
  });

  // A member's read state (spec F4, check 23): { read: [itemId…], unread: [itemId…] }. Marking an
  // item that doesn't exist is ignored. Visitors get 401 (their read state stays in the browser).
  router.post("/read-state", requireInstance(), readSession(), requireMember(), async (req, res, next) => {
    try {
      const read = itemIds(req.body?.read);
      const unread = itemIds(req.body?.unread);
      if (!read || !unread) {
        res.status(400).json({ error: "bad_items", message: `Send at most ${READ_BATCH_LIMIT} item ids.` });
        return;
      }
      const instance = res.locals.instance as Instance;
      const viewer = res.locals.viewer as Viewer;
      await forAccount(instance.id, viewer.accountId, async (db) => {
        if (read.length > 0) {
          await db.query(
            `INSERT INTO river.read_state (item_id)
             SELECT i.id FROM river.items i WHERE i.id = ANY($1::uuid[])
             ON CONFLICT (account_id, item_id) DO NOTHING`,
            [read],
          );
        }
        if (unread.length > 0) {
          await db.query("DELETE FROM river.read_state WHERE item_id = ANY($1::uuid[])", [unread]);
        }
      });
      res.status(204).set("Cache-Control", "no-store").end();
    } catch (err) {
      next(err);
    }
  });

  // "Mark all read" for the member's current view: { mode?, circle? (one or a list), type?, network?, q? }.
  router.post("/read-state/all", requireInstance(), readSession(), requireMember(), async (req, res, next) => {
    try {
      const marked = await memberMarkAllRead(res.locals.instance as Instance, res.locals.viewer as Viewer, {
        mode: bodyParam(req.body, "mode"),
        circle: bodyParamList(req.body, "circle"),
        type: bodyParam(req.body, "type"),
        network: bodyParam(req.body, "network"),
        q: bodyParam(req.body, "q"),
      });
      res.set("Cache-Control", "no-store").json({ marked });
    } catch (err) {
      feedError(err, res, next);
    }
  });

  // A member's export (spec 3.3, check 29): follows, circles and preferences as JSON, offered as a
  // download. Visitors get 401. Holds no email address or key (the River has neither).
  router.get("/me/export", requireInstance(), readSession(), requireMember(), async (_req, res, next) => {
    try {
      const instance = res.locals.instance as Instance;
      const viewer = res.locals.viewer as Viewer;
      const doc = await forAccount(instance.id, viewer.accountId, (db) => memberExport(db, viewer.did, new Date()));
      res
        .set("Cache-Control", "no-store")
        .set("Content-Disposition", 'attachment; filename="mosaic-river-export.json"')
        .json(doc);
    } catch (err) {
      next(err);
    }
  });

  // Unknown API paths get JSON, not Express's HTML page.
  router.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Anything unexpected: a plain JSON 500, logged without request details.
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(`River API error: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: "server_error" });
  });

  return router;
}
