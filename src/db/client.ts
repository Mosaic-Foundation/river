// Raw database client. Only files under src/db/ may import @supabase/supabase-js
// (enforced by eslint.config.js); everything else uses the helpers exported here.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";

let client: SupabaseClient | undefined;

/** Lazy singleton using the service-role key. Server-side only; never sent to the browser. */
export function getDb(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false },
    });
  }
  return client;
}
