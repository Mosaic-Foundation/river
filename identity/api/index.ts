// Vercel serverless entry for the mosaic-id project (Root Directory identity/; ADR-006 calls it
// river-identity, see DECISIONS.md).
// identity/vercel.json rewrites every path that isn't a static file in identity/public/ here,
// so nothing is stripped: /health stays /health.
import { createApp } from "../../src/app.js";
import { toVercelHandler } from "../../src/shared/http/vercel.js";

export const maxDuration = 60;

export default toVercelHandler(createApp("identity"));
