// Local development server. Vercel uses api/index.ts instead.
import { app } from "./app.js";
import { env } from "./config/env.js";

const port = env.port;
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
