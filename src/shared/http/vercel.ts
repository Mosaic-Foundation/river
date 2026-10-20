// Adapts an Express app to a Vercel Node function. Used by api/index.ts (River) and
// identity/api/index.ts (identity host).
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Express } from "express";

export type VercelHandler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * `stripPrefix` removes a path prefix before routing, so Express sees the same paths as the
 * local dev server. The River's vercel.json rewrites /api/* to the function (/api/health ->
 * /health); the identity host rewrites every path and strips nothing.
 */
export function toVercelHandler(app: Express, options: { stripPrefix?: string } = {}): VercelHandler {
  const { stripPrefix } = options;
  return (req, res) => {
    if (stripPrefix && req.url?.startsWith(stripPrefix)) {
      const rest = req.url.slice(stripPrefix.length);
      if (rest === "" || rest.startsWith("/") || rest.startsWith("?")) {
        req.url = rest.startsWith("/") ? rest : `/${rest}`;
      }
    }
    app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
  };
}
