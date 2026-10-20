import express, { type Express } from "express";

/**
 * Builds the Express app. Used by src/index.ts (local dev server) and api/index.ts (Vercel).
 * Keep routes free of process.env reads and raw database clients; see eslint.config.js.
 */
export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  return app;
}

export const app = createApp();
