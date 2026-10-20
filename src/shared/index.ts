// Code shared by the River and the identity host: app names, shared routes, HTTP glue. Later the
// item model, fetch guard (src/shared/fetch/) and sanitizer (src/shared/sanitize/) live here too.
export { APP_NAMES, DEFAULT_PORTS, isAppName, type AppName } from "./appName.js";
export { sharedRoutes } from "./routes.js";
export { toVercelHandler, type VercelHandler } from "./http/vercel.js";
