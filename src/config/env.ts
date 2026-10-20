// The only place the server reads process.env (enforced by eslint.config.js).
// Add each new variable here, and list its name (no value) in .env.example.

export function envVar(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

export function requireEnv(name: string): string {
  const value = envVar(name);
  if (value === undefined) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export const env = {
  get port(): number {
    return Number(envVar("PORT") ?? 3000);
  },
  get supabaseUrl(): string {
    return requireEnv("SUPABASE_URL");
  },
  get supabaseServiceRoleKey(): string {
    return requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
};
