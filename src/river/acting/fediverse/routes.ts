// Linking a fediverse account (fediverse-posting-1.md item 1; ADR-011), members only. Mounted by
// actingRoutes(), after checkOrigin().
//
//   POST /linked-accounts/fediverse/check  { input }  → { handle, server, software, maxCharacters }
//        Finds the server (WebFinger, NodeInfo, discovery, instance) and says whether the River can
//        link with it, before the member is told what linking allows (item 1.3).
//
// Refusals answer 4xx or 502 with { error, message }, the message naming the server. Rate-limited
// per account (429).
import { Router, type Response } from "express";
import type { Viewer } from "../../accounts.js";
import { readSession, requireMember } from "../../auth/session.js";
import { requireInstance } from "../../instances.js";
import { limitBy } from "../../rateLimit.js";
import { fediverseGuard } from "./guard.js";
import { BAD_INPUT_MESSAGE, checkServer, findAccount, LinkError, softwareLabel } from "./server.js";

/** HTTP status per refusal. */
const STATUS: Record<LinkError["code"], number> = {
  bad_input: 400,
  not_found: 422,
  unsupported_software: 422,
  unsupported_version: 422,
  unreachable: 502,
  busy: 503,
};

export function linkError(res: Response, err: LinkError): void {
  res.status(STATUS[err.code]).set("Cache-Control", "no-store").json({ error: err.code, message: err.message });
}

/** The member's input: one string of sensible length. */
export function readInput(body: unknown): string {
  const input = (body as { input?: unknown } | undefined)?.input;
  if (typeof input !== "string" || input.trim() === "" || input.length > 512) throw new LinkError("bad_input", BAD_INPUT_MESSAGE);
  return input.trim();
}

export function fediverseLinkRoutes(): Router {
  const router = Router();
  const perAccount = (res: Response) => (res.locals.viewer as Viewer).accountId;

  router.post(
    "/linked-accounts/fediverse/check",
    requireInstance(),
    readSession(),
    requireMember(),
    limitBy("fediverseLink", perAccount),
    async (req, res, next) => {
      try {
        const guard = await fediverseGuard();
        const account = await findAccount(guard, readInput(req.body));
        const server = await checkServer(guard, account.host);
        res.set("Cache-Control", "no-store").json({
          handle: account.handle,
          server: server.host,
          software: softwareLabel(server.software),
          maxCharacters: server.maxCharacters,
        });
      } catch (err) {
        if (err instanceof LinkError) {
          linkError(res, err);
          return;
        }
        next(err);
      }
    },
  );

  return router;
}
