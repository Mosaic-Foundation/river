// Vercel serverless entry for the river-identity project (Root Directory identity/, ADR-006).
// identity/vercel.json rewrites every path that isn't a static file in identity/public/ here,
// so nothing is stripped: /health stays /health.
import { createApp } from "../../src/app.js";
import { toVercelHandler } from "../../src/shared/http/vercel.js";

export const maxDuration = 60;

export default toVercelHandler(createApp("identity"));
