// Vercel serverless entry. vercel.json rewrites /api/* here; we strip the /api prefix so the
// Express routes match the same paths as the local dev server (e.g. /api/health -> /health).
import type { IncomingMessage, ServerResponse } from "node:http";
import { app } from "../src/app.js";

export const maxDuration = 60;

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url?.startsWith("/api")) {
    req.url = req.url.slice("/api".length) || "/";
  }
  app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
