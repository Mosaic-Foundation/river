// River API routes (spec 2, 4.5). Mounted by createApp("river") only; River code never imports
// src/identity/ (CLAUDE.md constraint 7). Paths here are what the browser sees after /api/
// (the dev proxy and api/index.ts both strip the prefix).
import { Router, type NextFunction, type Request, type Response } from "express";
import { FeedInputError, visitorFeed, type FeedParams } from "./feed/index.js";
import { requireInstance, type Instance } from "./instances.js";

/** A query parameter as one string; repeated or nested values are refused, not guessed at. */
function param(req: Request, name: string): string | undefined {
  const value = req.query[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new FeedInputError(name as FeedInputError["field"], `${name} must be given once`);
  return value;
}

export function riverRoutes(): Router {
  const router = Router();

  // Says which app answered, for checking a deployment. Needs no database.
  router.get("/", (_req, res) => {
    res.json({ app: "river", name: "Mosaic River" });
  });

  // The feed (spec 4.5). Visitors only until sign-in (M8); a visitor's request writes nothing
  // but the refresh's source data (check 23).
  router.get("/feed", requireInstance(), async (req, res, next) => {
    try {
      const params: FeedParams = {
        mode: param(req, "mode"),
        circle: param(req, "circle"),
        type: param(req, "type"),
        q: param(req, "q"),
        cursor: param(req, "cursor"),
      };
      const feed = await visitorFeed(res.locals.instance as Instance, params);
      res.set("Cache-Control", "no-store").json(feed);
    } catch (err) {
      if (err instanceof FeedInputError) {
        res.status(400).json({ error: `bad_${err.field}`, message: err.message });
        return;
      }
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
