import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The River's Content-Security-Policy (spec Appendix B) lives in ../vercel.json, which Vercel
// serves in production. `vite preview` (what CI's e2e tests run against) serves the same header,
// read from that file, so the tests exercise the real policy. The dev server adds only what Vite's
// dev tooling needs: a per-start nonce for the inline React Refresh preamble and injected styles.
function productionCsp(): string {
  const vercel = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
    headers?: Array<{ headers: Array<{ key: string; value: string }> }>;
  };
  const value = vercel.headers
    ?.flatMap((rule) => rule.headers)
    .find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
  if (!value) throw new Error("vercel.json has no Content-Security-Policy header");
  return value;
}

function withNonce(csp: string, nonce: string): string {
  return csp
    .split(";")
    .map((part) => part.trim())
    .map((part) =>
      /^(script-src|style-src) /.test(part) ? `${part} 'nonce-${nonce}'` : part,
    )
    .join("; ");
}

// In dev, /api/* is proxied to the Express server on :3000 with the /api prefix removed,
// matching how vercel.json and api/index.ts behave in production. The browser's Host header is
// passed through (changeOrigin: false), as Vercel does, so the API maps the page's own hostname
// to its instance (check 26: unknown.localhost gets the 404 page).
const apiProxy = {
  "/api": {
    target: "http://localhost:3000",
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/api/, "") || "/",
  },
};

export default defineConfig(({ command }) => {
  const csp = productionCsp();
  const nonce = randomBytes(16).toString("base64");
  return {
    plugins: [react()],
    // Fonts and small images stay files: CSP allows no data: URIs.
    build: { assetsInlineLimit: 0 },
    html: command === "serve" ? { cspNonce: nonce } : undefined,
    server: {
      port: 5173,
      strictPort: true,
      proxy: apiProxy,
      headers: { "Content-Security-Policy": withNonce(csp, nonce) },
    },
    preview: {
      proxy: apiProxy,
      headers: { "Content-Security-Policy": csp },
    },
  };
});
