// Local development server for either app: `npm run dev` (River, :3000) or
// `npm run dev:identity` (identity host, :3001). Vercel uses api/index.ts and
// identity/api/index.ts instead.
import { createApp } from "./app.js";
import { env } from "./config/env.js";

const name = env.app;
const port = env.port;
createApp(name).listen(port, () => {
  console.log(`${name} listening on http://localhost:${port}`);
});
