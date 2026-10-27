// Acting for members (ADR-010), members only. Mounted inside riverRoutes(), after checkOrigin().
//
//   GET /activity?cursor=   → { viewer, entries, nextCursor }   Your activity (ADR-010 §7), read only
//
// Visitors get 401 "sign_in_required"; the UI shows them a sign-up prompt instead.
import { Router } from "express";
import type { Viewer } from "../accounts.js";
import { readSession, requireMember } from "../auth/session.js";
import { requireInstance, type Instance } from "../instances.js";
import { ActivityCursorError, listActivity } from "./activity.js";

export function actingRoutes(): Router {
  const router = Router();

  router.get("/activity", requireInstance(), readSession(), requireMember(), async (req, res, next) => {
    try {
      const cursor = req.query.cursor;
      if (cursor !== undefined && typeof cursor !== "string") {
        res.status(400).json({ error: "bad_cursor", message: "cursor must be given once" });
        return;
      }
      const viewer = res.locals.viewer as Viewer;
      const page = await listActivity((res.locals.instance as Instance).id, viewer.accountId, cursor);
      res.set("Cache-Control", "no-store").json({ viewer: { did: viewer.did, displayName: viewer.displayName }, ...page });
    } catch (err) {
      if (err instanceof ActivityCursorError) {
        res.status(400).json({ error: "bad_cursor", message: err.message });
        return;
      }
      next(err);
    }
  });

  return router;
}
