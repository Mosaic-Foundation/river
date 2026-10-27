// Tests only: drives the stand-in fediverse server (tests/support/standInMastodon/) inside the dev
// server. Mounted by riverRoutes() before the Origin check, and only when both TEST_ROUTES=1 and
// TEST_STAND_IN_FEDIVERSE=1 (each refused on Vercel by env.ts). These answers hold tokens and
// client secrets the stand-in issued: they are test values, and the routes never exist elsewhere.
//
//   POST /test/stand-in-fediverse/reset                       forget requests, rules, apps and tokens
//   PUT  /test/stand-in-fediverse/rules      [rule, …]        replace the rules
//   POST /test/stand-in-fediverse/authorize  { url, username, deny? } → { location } | { error }
//   POST /test/stand-in-fediverse/revoke-all                  revoke every token, as if removed there
//   GET  /test/stand-in-fediverse/requests                   → every request it received
//   GET  /test/stand-in-fediverse/tokens                     → the tokens it issued
//   GET  /test/stand-in-fediverse/apps                       → the apps registered with it, secrets included
import { Router } from "express";
import { standInFediverse } from "./guard.js";

export function standInFediverseRoutes(): Router {
  const router = Router();
  const base = "/test/stand-in-fediverse";

  router.post(`${base}/reset`, async (_req, res) => {
    (await standInFediverse()).standIn.reset();
    res.status(204).end();
  });

  router.put(`${base}/rules`, async (req, res) => {
    const { standIn } = await standInFediverse();
    if (!Array.isArray(req.body)) {
      res.status(400).json({ error: "rules must be an array" });
      return;
    }
    standIn.rules.length = 0;
    standIn.rules.push(...(req.body as unknown[]));
    res.status(204).end();
  });

  router.post(`${base}/authorize`, async (req, res) => {
    const { standIn } = await standInFediverse();
    const { url, username, deny } = (req.body ?? {}) as { url?: unknown; username?: unknown; deny?: unknown };
    if (typeof url !== "string" || typeof username !== "string") {
      res.status(400).json({ error: "url and username are required" });
      return;
    }
    res.json(standIn.authorize(url, username, { deny: deny === true }));
  });

  router.post(`${base}/revoke-all`, async (_req, res) => {
    (await standInFediverse()).standIn.revokeAll();
    res.status(204).end();
  });

  router.get(`${base}/requests`, async (_req, res) => {
    res.set("Cache-Control", "no-store").json((await standInFediverse()).standIn.requests);
  });

  router.get(`${base}/tokens`, async (_req, res) => {
    res.set("Cache-Control", "no-store").json([...(await standInFediverse()).standIn.tokens.keys()]);
  });

  router.get(`${base}/apps`, async (_req, res) => {
    res.set("Cache-Control", "no-store").json([...(await standInFediverse()).standIn.apps.values()]);
  });

  return router;
}
