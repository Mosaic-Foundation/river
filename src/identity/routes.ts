// Identity host routes (spec 4.6). Mounted by createApp("identity") only; identity code never
// imports src/river/ (CLAUDE.md constraint 7). Its pages are server-rendered HTML with no inline
// script (Appendix B); the passkey script is bundled from src/identity/client/ into
// identity/public/, which Vercel serves as static files and the dev server serves below.
import path from "node:path";
import express, { Router } from "express";

/** Where `npm run build:identity-client` writes the bundled browser script. */
const PUBLIC_DIR = path.resolve("identity", "public");

export function identityRoutes(): Router {
  const router = Router();

  router.use(express.static(PUBLIC_DIR, { index: false, fallthrough: true }));

  // Placeholder until M7 adds the authorize and sign-up pages.
  router.get("/", (_req, res) => {
    res.type("html").send(page("Mosaic ID", "<p>Mosaic ID signs you in to Mosaic River.</p>"));
  });

  router.use((_req, res) => {
    res.status(404).type("html").send(page("Not found", "<p>There is nothing at this address.</p>"));
  });

  return router;
}

/** Minimal page shell. Callers pass trusted, static markup only. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body>
<main>
<h1>${title}</h1>
${body}
</main>
</body>
</html>
`;
}
