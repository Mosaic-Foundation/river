import express, { type Express } from "express";
import { checkEnv } from "./config/env.js";
import { identityRoutes } from "./identity/index.js";
import { riverRoutes } from "./river/index.js";
import { sharedRoutes, type AppName } from "./shared/index.js";

/**
 * Builds the Express app for one side (ADR-006), mounting only that side's routes.
 * Used by src/index.ts (local dev server, from env.app), api/index.ts (River on Vercel) and
 * identity/api/index.ts (identity host on Vercel).
 * Keep routes free of process.env reads and raw database clients; see eslint.config.js.
 */
export function createApp(kind: AppName): Express {
  checkEnv();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.use(sharedRoutes(kind));
  app.use(kind === "river" ? riverRoutes() : identityRoutes());

  return app;
}
