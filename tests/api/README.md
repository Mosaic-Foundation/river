# API tests

API tests call a running dev server over HTTP with `fetch`, against a local Supabase stack.
They never import backend modules directly. This matches the Civic Hub.

To run them:

```bash
npx supabase start          # local Postgres + API in Docker
npm run dev &               # API on :3000, reading .env (see .env.example)
npm run test:api
```

Name files `*.test.ts`. Outside services are replaced by fakes behind environment flags
(read through `src/config/env.ts`), never by calls to real third-party APIs.
