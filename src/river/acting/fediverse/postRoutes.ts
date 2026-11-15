// Posts and replies (fediverse-posting-1.md item 3; ADR-010 §4, §9, §10), members only. Mounted by
// actingRoutes(), after checkOrigin().
//
//   GET  /acts/fediverse/compose?replyTo={itemId}  → { accounts, replyTo }   what the composer needs
//   POST /acts/fediverse/preview  { linkedAccountId, text, spoilerText?, visibility, language?, replyToItemId? }
//                                                  → the preview (its id, the exact request)
//   POST /acts/:id/send                            → SendResult (sent, failed or unknown)
//   POST /acts/:id/retry                           → SendResult (Try again on an unknown post)
//   POST /acts/:id/delete                          → DeleteResult (delete a post made from the River)
//
// Boost, favourite and follow (item 4, A4; toggles.ts), one click each, no preview:
//   GET  /acts/fediverse/state?linkedAccountId=&itemId=          → { reblogged, favourited }
//   POST /acts/fediverse/toggle  { linkedAccountId, itemId, verb: boost|unboost|favourite|unfavourite }
//                                                                → ToggleResult
//   GET  /acts/fediverse/relationship?linkedAccountId=&spaceId=  → { following, requested }
//   POST /acts/fediverse/follow  { linkedAccountId, spaceId, verb: follow|unfollow } → ToggleResult
//   POST /acts/:id/undo                                          → ToggleResult (undo a boost,
//                                                                  favourite or follow from Your activity)
//
// Send and Try again answer 200 with what happened, since the act was attempted and recorded;
// refusals before anything was sent answer 4xx or 5xx with { error, message, retryAt? }.
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Viewer } from "../../accounts.js";
import { readSession, requireMember } from "../../auth/session.js";
import { requireInstance, type Instance } from "../../instances.js";
import { limitBy } from "../../rateLimit.js";
import type { Actor } from "../acts.js";
import { deletePost } from "./deletes.js";
import { fediverseGuard } from "./guard.js";
import { composeInfo, PostError, previewPost, retryPost, sendPost, type PostInput } from "./posts.js";
import { followSpace, relationship, statusState, togglePost, undoToggle } from "./toggles.js";

const STATUS: Record<PostError["code"], number> = {
  bad_input: 400,
  no_link: 409,
  not_found: 422,
  revoked: 409,
  scope: 403,
  rejected: 422,
  rate_limited: 429,
  unreachable: 502,
  limit: 429,
  session_ended: 401,
  preview_expired: 410,
  already_sent: 409,
  cannot_retry: 409,
};

function postError(res: Response, err: PostError): void {
  if (err.retryAt) res.set("Retry-After", String(Math.max(1, Math.ceil((err.retryAt.getTime() - Date.now()) / 1000))));
  res
    .status(STATUS[err.code])
    .set("Cache-Control", "no-store")
    .json({ error: err.code, message: err.message, retryAt: err.retryAt?.toISOString() ?? null });
}

function actor(res: Response): Actor {
  const viewer = res.locals.viewer as Viewer;
  return { instanceId: (res.locals.instance as Instance).id, accountId: viewer.accountId, sessionEpoch: viewer.sessionEpoch };
}

export function postRoutes(): Router {
  const router = Router();
  const member = [requireInstance(), readSession(), requireMember()];
  const perAccount = (res: Response) => (res.locals.viewer as Viewer).accountId;

  /** Runs a handler, answering PostErrors as refusals. */
  const handle =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const body = await fn(req, res);
        res.set("Cache-Control", "no-store").json(body);
      } catch (err) {
        if (err instanceof PostError) {
          postError(res, err);
          return;
        }
        next(err);
      }
    };

  router.get(
    "/acts/fediverse/compose",
    ...member,
    handle(async (req, res) => {
      const replyTo = req.query.replyTo;
      if (replyTo !== undefined && typeof replyTo !== "string") throw new PostError("bad_input", "replyTo must be given once");
      return composeInfo(await fediverseGuard(), actor(res), replyTo);
    }),
  );

  router.post(
    "/acts/fediverse/preview",
    ...member,
    limitBy("actPreview", perAccount),
    handle(async (req, res) => previewPost(await fediverseGuard(), actor(res), (req.body ?? {}) as PostInput)),
  );

  router.post(
    "/acts/:id/send",
    ...member,
    handle(async (req, res) => sendPost(await fediverseGuard(), actor(res), req.params.id ?? "")),
  );

  router.post(
    "/acts/:id/retry",
    ...member,
    handle(async (req, res) => retryPost(await fediverseGuard(), actor(res), req.params.id ?? "")),
  );

  router.post(
    "/acts/:id/delete",
    ...member,
    handle(async (req, res) => deletePost(await fediverseGuard(), actor(res), req.params.id ?? "")),
  );

  /** A query parameter given once, or undefined. */
  const one = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

  router.get(
    "/acts/fediverse/state",
    ...member,
    limitBy("actState", perAccount),
    handle(async (req, res) => statusState(await fediverseGuard(), actor(res), one(req.query.linkedAccountId), one(req.query.itemId))),
  );

  router.post(
    "/acts/fediverse/toggle",
    ...member,
    limitBy("actToggle", perAccount),
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return togglePost(await fediverseGuard(), actor(res), { linkedAccountId: body.linkedAccountId, itemId: body.itemId, verb: body.verb });
    }),
  );

  router.get(
    "/acts/fediverse/relationship",
    ...member,
    limitBy("actState", perAccount),
    handle(async (req, res) => relationship(await fediverseGuard(), actor(res), one(req.query.linkedAccountId), one(req.query.spaceId))),
  );

  router.post(
    "/acts/fediverse/follow",
    ...member,
    limitBy("actToggle", perAccount),
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      return followSpace(await fediverseGuard(), actor(res), { linkedAccountId: body.linkedAccountId, spaceId: body.spaceId, verb: body.verb });
    }),
  );

  router.post(
    "/acts/:id/undo",
    ...member,
    limitBy("actToggle", perAccount),
    handle(async (req, res) => undoToggle(await fediverseGuard(), actor(res), req.params.id ?? "")),
  );

  return router;
}
