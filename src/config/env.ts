// The only place the server reads process.env (enforced by eslint.config.js).
// Add each new variable here, and list its name (no value) in .env.example (River) or
// .env.identity.example (identity host). Getters are lazy, so a variable is only required once
// the code that needs it runs; both apps start and answer /health with none of them set.
import { DEFAULT_PORTS, isAppName, type AppName } from "../shared/appName.js";

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

/** Comma-separated list, trimmed, empty entries dropped. */
export function envList(name: string): string[] {
  return (envVar(name) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export const EMAIL_TRANSPORTS = ["log", "capture", "resend"] as const;
export type EmailTransport = (typeof EMAIL_TRANSPORTS)[number];

/** Variables that switch on test-only behavior. They must never reach a Vercel deployment. */
export const TEST_ONLY_VARS = [
  "FETCH_FIXTURES_DIR",
  "TEST_ROUTES",
  "TEST_CLOCK_NOW",
  "TEST_DID_LOOPBACK",
  "TEST_STAND_IN_FEDIVERSE",
] as const;

/**
 * Reads a test-only variable, refusing when running on Vercel (which always sets VERCEL) or with
 * NODE_ENV=production (a production build anywhere else).
 */
function testOnlyVar(name: (typeof TEST_ONLY_VARS)[number]): string | undefined {
  const value = envVar(name);
  if (value !== undefined && envVar("VERCEL") !== undefined) {
    throw new Error(`${name} is for local runs and CI only; it must not be set on Vercel`);
  }
  if (value !== undefined && envVar("NODE_ENV") === "production") {
    throw new Error(`${name} is for local runs and CI only; it must not be set with NODE_ENV=production`);
  }
  return value;
}

export const env = {
  // --- Both apps ---

  /** `river` (default) or `identity` (ADR-006). */
  get app(): AppName {
    const value = envVar("APP") ?? "river";
    if (!isAppName(value)) {
      throw new Error(`APP must be "river" or "identity", got "${value}"`);
    }
    return value;
  },
  /** Local dev port; defaults to 3000 for the River and 3001 for the identity host. */
  get port(): number {
    const value = envVar("PORT");
    return value === undefined ? DEFAULT_PORTS[this.app] : Number(value);
  },
  /**
   * Postgres through Supabase's transaction pooler, as `river_app` or `identity_app` (spec 3).
   * Read only when the pool is first used, so the apps start without it.
   */
  get databaseUrl(): string {
    return requireEnv("DATABASE_URL");
  },
  /**
   * PEM certificate of the CA that signed the database server's certificate, for when Node's own
   * store doesn't hold it (Supabase: Dashboard → Database → SSL Configuration). Optional; TLS is
   * verified either way (src/db/pool.ts). A value pasted with literal `\n`s is accepted.
   */
  get databaseCaCert(): string | undefined {
    const value = envVar("DATABASE_CA_CERT")?.replaceAll("\\n", "\n");
    if (value !== undefined && !value.includes("-----BEGIN CERTIFICATE-----")) {
      throw new Error("DATABASE_CA_CERT must be a PEM certificate (-----BEGIN CERTIFICATE-----)");
    }
    return value;
  },
  /** Signs each app's own session cookie. */
  get sessionSecret(): string {
    return requireEnv("SESSION_SECRET");
  },
  /** Replays recorded responses from this folder instead of calling outside hosts (tests). */
  get fetchFixturesDir(): string | undefined {
    return testOnlyVar("FETCH_FIXTURES_DIR");
  },
  /** `1` mounts routes that only tests use. */
  get testRoutes(): boolean {
    return testOnlyVar("TEST_ROUTES") === "1";
  },
  /**
   * A fixed "now" for the River's adapters (ISO 8601), so replayed feed URLs, which carry
   * `since`, match the recordings (tests/fixtures/civicHubClock.ts). Database time is unchanged.
   */
  get testClockNow(): Date | undefined {
    const value = testOnlyVar("TEST_CLOCK_NOW");
    if (value === undefined) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`TEST_CLOCK_NOW must be an ISO 8601 date, got "${value}"`);
    }
    return date;
  },
  /**
   * `1` lets the River read DID logs from a TRUSTED_DID_HOSTS host on loopback over http (the
   * identity dev server at localhost:3001), through src/shared/fetch/loopback.ts. Local runs and
   * CI only; production reads every DID log over https through the fetch guard (DECISIONS, M8).
   */
  get testDidLoopback(): boolean {
    return testOnlyVar("TEST_DID_LOOPBACK") === "1";
  },

  /**
   * `1` sends the River's acting requests for fediverse accounts to the stand-in server
   * (tests/support/standInMastodon/, fediverse-posting-1 item 9) instead of the network, and, with
   * TEST_ROUTES, mounts the routes that drive it. Local runs and CI only.
   */
  get testStandInFediverse(): boolean {
    return testOnlyVar("TEST_STAND_IN_FEDIVERSE") === "1";
  },

  // --- River (spec Appendix D) ---

  /** The River's own origin: the note's `aud`, the sign-in `redirect_uri`, Origin checks. */
  get riverPublicOrigin(): string {
    return requireEnv("RIVER_PUBLIC_ORIGIN");
  },
  /** Where the River sends people to sign in (the identity host's origin). */
  get identityOrigin(): string {
    return requireEnv("IDENTITY_ORIGIN");
  },
  /** DID hosts whose signed notes the River accepts. v1: id.mosaic.social only. */
  get trustedDidHosts(): string[] {
    return envList("TRUSTED_DID_HOSTS");
  },
  /** Extra hostnames that resolve to the seed instance (localhost, vercel.app hosts). */
  get instanceHostAliases(): string[] {
    return envList("INSTANCE_HOST_ALIASES").map((host) => host.toLowerCase());
  },
  /**
   * Vercel's deployment kind (`production`, `preview`, `development`), set by Vercel itself. On a
   * preview every host gets the seed instance (spec check 26).
   */
  get vercelEnv(): string | undefined {
    return envVar("VERCEL_ENV");
  },
  /** True on any Vercel deployment (Vercel sets VERCEL itself). */
  get onVercel(): boolean {
    return envVar("VERCEL") !== undefined;
  },
  /**
   * 32 random bytes, base64. Wraps the data keys of the credentials the River holds to act for
   * members (ADR-010 §5; src/river/acting/crypto/). River project only, Production; never in the
   * identity project, the database or a log. Read only when a credential is sealed or opened, so
   * the River runs without it until acting is used.
   */
  get riverTokenKey(): string {
    return requireEnv("RIVER_TOKEN_KEY");
  },

  // --- Identity host (spec Appendix D) ---

  /** 32 random bytes, base64. Wraps each person's data key. Identity host only; never logged. */
  get identityMasterKey(): string {
    return requireEnv("IDENTITY_MASTER_KEY");
  },
  /**
   * The public half of Mosaic's offline recovery key, in multikey format (`z6Mk…`, Ed25519). Every
   * new DID lists it as its second update key (spec 4.6, check 37). The private half never touches
   * a server or an environment variable: `npm run recover-dids` reads it from a file or a prompt.
   */
  get identityRecoveryPublicKey(): string {
    return requireEnv("IDENTITY_RECOVERY_PUBLIC_KEY");
  },
  /** WebAuthn relying party ID: id.mosaic.social, or localhost locally. */
  get rpId(): string {
    return requireEnv("RP_ID");
  },
  /** The identity host's own origin. */
  get identityPublicOrigin(): string {
    return requireEnv("IDENTITY_PUBLIC_ORIGIN");
  },
  /** Exact River origins allowed to sign in; each gets its /api/auth/callback redirect URI. */
  get riverClientOrigins(): string[] {
    return envList("RIVER_CLIENT_ORIGINS");
  },
  /** `log` (default: one redacted line per email), `capture` (tests) or `resend`. */
  get emailTransport(): EmailTransport {
    const value = envVar("EMAIL_TRANSPORT") ?? "log";
    if (!(EMAIL_TRANSPORTS as readonly string[]).includes(value)) {
      throw new Error(`EMAIL_TRANSPORT must be one of ${EMAIL_TRANSPORTS.join(", ")}, got "${value}"`);
    }
    // Captured mail sits in memory and the TEST_ROUTES mailbox reads it: never in production.
    if (value === "capture" && envVar("VERCEL_ENV") === "production") {
      throw new Error("EMAIL_TRANSPORT=capture is for tests; it must not be set in production");
    }
    return value as EmailTransport;
  },
  get resendApiKey(): string {
    return requireEnv("RESEND_API_KEY");
  },
  /** e.g. `Mosaic ID <id@mosaic.social>`. */
  get emailFrom(): string {
    return requireEnv("EMAIL_FROM");
  },
};

/**
 * Fails fast on settings that must never ship: an unknown APP, a bad EMAIL_TRANSPORT (or capture
 * in production), or a test-only variable on Vercel or with NODE_ENV=production. createApp() calls it, so a misconfigured deployment fails its
 * /health check instead of running with test behavior.
 */
export function checkEnv(): void {
  void env.app;
  void env.emailTransport;
  void env.fetchFixturesDir;
  void env.testRoutes;
  void env.testClockNow;
  void env.testDidLoopback;
  void env.testStandInFediverse;
}
