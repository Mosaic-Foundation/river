// Vercel serverless entry for the River project (repo root). vercel.json rewrites /api/* here;
// the /api prefix is stripped so Express sees the same paths as the local dev server
// (e.g. /api/health -> /health).
import { createApp } from "../src/app.js";
import { toVercelHandler } from "../src/shared/http/vercel.js";

export const maxDuration = 60;

export default toVercelHandler(createApp("river"), { stripPrefix: "/api" });
