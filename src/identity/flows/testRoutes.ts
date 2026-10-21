// Routes for tests only, mounted when TEST_ROUTES=1, which env.ts refuses on Vercel. They read the
// capture mailbox, move the identity clock, and reset the in-memory rate limits.
import { Router } from "express";
import { env } from "../../config/env.js";
import { clockOffset, setClockOffset } from "../clock.js";
import { capturedEmails, clearCapturedEmails } from "../email/index.js";
import { resetRateLimits } from "../rateLimit.js";

export function testRoutes(): Router {
  const router = Router();

  router.get("/test/mailbox", (req, res) => {
    if (env.emailTransport !== "capture") {
      res.status(409).json({ error: "EMAIL_TRANSPORT is not capture" });
      return;
    }
    const to = typeof req.query.to === "string" ? req.query.to.toLowerCase() : undefined;
    res.json({ messages: capturedEmails().filter((m) => to === undefined || m.to === to) });
  });

  router.delete("/test/mailbox", (_req, res) => {
    clearCapturedEmails();
    res.status(204).end();
  });

  router.post("/test/clock", (req, res) => {
    const offsetMs = Number(req.body?.offsetMs ?? 0);
    setClockOffset(offsetMs);
    res.json({ offsetMs: clockOffset() });
  });

  router.post("/test/rate-limits/reset", (_req, res) => {
    resetRateLimits();
    res.status(204).end();
  });

  return router;
}
