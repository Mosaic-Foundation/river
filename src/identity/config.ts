// The identity host's settings, read once from env.ts (spec Appendix D, 3.2).
//
// `clients` (spec 3.2) is not a table: it is built here from RIVER_CLIENT_ORIGINS, each origin
// with its /api/auth/callback path as the one exact redirect URI, so no migration hard-codes a
// host. A request is accepted only when client_id equals one of these origins and redirect_uri
// equals that client's URI exactly (check 12).
import { env } from "../config/env.js";
import { fromMultikey } from "./keys/index.js";

export interface Client {
  clientId: string;
  redirectUris: readonly string[];
  name: string;
}

export const RP_NAME = "Mosaic ID";
export const CALLBACK_PATH = "/api/auth/callback";

/** Parses one River origin; refuses paths, credentials, queries and plain http off localhost. */
export function parseClientOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`RIVER_CLIENT_ORIGINS has an entry that is not a URL: ${JSON.stringify(value)}`);
  }
  if (url.origin !== value.replace(/\/$/, "") || url.username || url.password) {
    throw new Error(`RIVER_CLIENT_ORIGINS entries must be bare origins, got ${JSON.stringify(value)}`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`RIVER_CLIENT_ORIGINS entries must use https (http only on localhost): ${value}`);
  }
  return url.origin;
}

export function buildClients(origins: readonly string[]): ReadonlyMap<string, Client> {
  const clients = new Map<string, Client>();
  for (const value of origins) {
    const clientId = parseClientOrigin(value);
    clients.set(clientId, { clientId, redirectUris: [`${clientId}${CALLBACK_PATH}`], name: "Mosaic River" });
  }
  return clients;
}

/** The registered client for this exact pair, or undefined. No normalization: exact strings only. */
export function findClient(
  clients: ReadonlyMap<string, Client>,
  clientId: unknown,
  redirectUri: unknown,
): Client | undefined {
  if (typeof clientId !== "string" || typeof redirectUri !== "string") return undefined;
  const client = clients.get(clientId);
  return client && client.redirectUris.includes(redirectUri) ? client : undefined;
}

export interface IdentityConfig {
  origin: string;
  rpId: string;
  clients: ReadonlyMap<string, Client>;
  recoveryMultikey: string;
}

let cached: IdentityConfig | undefined;

/** Read on first use, so /health answers with no settings at all. */
export function identityConfig(): IdentityConfig {
  if (!cached) {
    const origin = new URL(env.identityPublicOrigin).origin;
    const recoveryMultikey = env.identityRecoveryPublicKey.trim();
    fromMultikey(recoveryMultikey); // throws unless it is an Ed25519 multikey
    cached = { origin, rpId: env.rpId, clients: buildClients(env.riverClientOrigins), recoveryMultikey };
  }
  return cached;
}
