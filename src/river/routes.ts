// River API routes (spec 2, 4.5). Mounted by createApp("river") only; River code never imports
// src/identity/ (CLAUDE.md constraint 7). Paths here are what the browser sees after /api/
// (the dev proxy and api/index.ts both strip the prefix).
import { Router } from "express";

export function riverRoutes(): Router {
  const router = Router();

  // Placeholder until M5 adds the feed: says which app answered, for checking a deployment.
  router.get("/", (_req, res) => {
    res.json({ app: "river", name: "Mosaic River" });
  });

  // Unknown API paths get JSON, not Express's HTML page.
  router.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  return router;
}
