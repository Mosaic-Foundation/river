// Identity host routes (spec 4.6). Mounted by createApp("identity") only; identity code never
// imports src/river/ (CLAUDE.md constraint 7). Its pages are server-rendered HTML with no inline
// script (Appendix B); the passkey script is bundled from src/identity/client/ into
// identity/public/, which Vercel serves as static files and the dev server serves below.
//
// The host keeps no session: every action that needs a person (sign-in, change email) starts with
// a fresh passkey check, and every emailed link carries its own single-use token.
import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { env } from "../config/env.js";
import { authorizeRoutes } from "./flows/authorize.js";
import { asyncRoutes } from "./flows/common.js";
import { didLogRoutes } from "./flows/didLog.js";
import { emailRoutes } from "./flows/email.js";
import { recoverRoutes } from "./flows/recover.js";
import { testRoutes } from "./flows/testRoutes.js";
import { noStore, sameOriginPosts, securityHeaders } from "./http.js";
import { IDENTITY_CSS, errorPage, homePage } from "./pages.js";

/** Where `npm run build:identity-client` writes the bundled browser script. */
const PUBLIC_DIR = path.resolve("identity", "public");

/** Longest error message logged. */
const MAX_LOGGED_MESSAGE = 300;

/**
 * The log line for a failed request. An error with a code (a database error's SQLSTATE, or a
 * driver or system code such as ECONNREFUSED) logs its name and code only: a database error's
 * message and detail can quote an email address or other stored values. An error without a code
 * also logs its message, on one line and capped: those are the configuration errors from
 * src/config/env.ts, src/db/pool.ts and src/identity/config.ts, which name a setting and never
 * hold personal data or the database URL.
 */
export function errorLogLine(method: string, path: string, err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === "string" && e.name ? e.name : "Error";
  const code = typeof e.code === "string" || typeof e.code === "number" ? String(e.code) : "";
  const head = `identity: ${method} ${path} failed: ${name}`;
  if (code) return `${head} (${code})`;
  const message = typeof e.message === "string" ? e.message.replace(/\s+/g, " ").trim() : "";
  if (!message) return head;
  const shown = message.length > MAX_LOGGED_MESSAGE ? `${message.slice(0, MAX_LOGGED_MESSAGE - 1)}…` : message;
  return `${head}: ${shown}`;
}

export function identityRoutes(): Router {
  const router = Router();

  router.use(securityHeaders);
  router.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true }));
  router.get("/identity.css", (_req, res) => {
    res.type("text/css").setHeader("Cache-Control", "public, max-age=300").send(IDENTITY_CSS);
  });
  router.get("/", (_req, res) => {
    res.type("html").send(homePage());
  });

  router.use(express.urlencoded({ extended: false, limit: "16kb" }));
  if (env.testRoutes) router.use(testRoutes());

  router.use(noStore);
  router.use(sameOriginPosts);
  const routes = asyncRoutes(router);
  didLogRoutes(routes);
  authorizeRoutes(routes);
  recoverRoutes(routes);
  emailRoutes(routes);

  router.use((_req, res) => {
    res.status(404).type("html").send(errorPage("Not found", "There is nothing at this address."));
  });

  // Errors: one log line (errorLogLine), then 500.
  router.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    void _next;
    console.error(errorLogLine(req.method, req.path, err));
    if (res.headersSent) return;
    if (req.accepts(["html", "json"]) === "json" || req.method === "POST") {
      res.status(500).json({ error: "server_error", message: "Something went wrong. Try again." });
    } else {
      res.status(500).type("html").send(errorPage("Something went wrong", "Try again in a moment."));
    }
  });

  return router;
}
