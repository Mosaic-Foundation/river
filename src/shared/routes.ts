// Routes both apps mount. Shared code imports neither src/river/ nor src/identity/.
import { Router } from "express";
import type { AppName } from "./appName.js";

export function sharedRoutes(name: AppName): Router {
  const router = Router();

  // Answers without a database, so a fresh deployment can be checked before secrets are set.
  router.get("/health", (_req, res) => {
    res.json({ ok: true, app: name });
  });

  return router;
}
