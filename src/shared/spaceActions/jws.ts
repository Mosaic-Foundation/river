// The JWS builder Mosaic ID uses to sign an action (space-actions-1 3.2, 3.3 and 5.2): a compact
// JWS with header `{alg: "EdDSA", typ: "mosaic-action+jwt", kid}` over the claims. Signing itself
// is handed in, as for the sign-in note (src/identity/note.ts), so the key never leaves the
// caller. Nothing here logs a JWS.
import { randomBytes } from "node:crypto";
import { checkAct } from "./act.js";
import {
  ACTION_LIFETIME_S,
  ACTION_TYP,
  ALG,
  MAX_LIFETIME_S,
  type Act,
  type ActionClaims,
  type ActionHeader,
  type Assurance,
} from "./types.js";

/** 16 random bytes, base64url (3.3). */
export function newJti(): string {
  return randomBytes(16).toString("base64url");
}

export interface ClaimsInput {
  /** The member's DID: `iss` and `sub`. */
  did: string;
  aud: string;
  htu: string;
  /** The origin of the client the signer authenticated; never taken from the client's request. */
  client: string;
  assurance: Assurance;
  act: Act;
  /** Seconds since the epoch. */
  now: number;
  /** Default ACTION_LIFETIME_S (120); at most MAX_LIFETIME_S. */
  lifetime?: number;
  /** Default newJti(). */
  jti?: string;
}

/** The claims to sign, in the order 3.3 lists them. Throws on an act 3.4 refuses or a bad lifetime. */
export function actionClaims(input: ClaimsInput): ActionClaims {
  const checked = checkAct(input.act);
  if (!checked.ok) throw new Error(`Not a valid act: ${checked.reason}`);
  const lifetime = input.lifetime ?? ACTION_LIFETIME_S;
  if (!Number.isInteger(lifetime) || lifetime <= 0 || lifetime > MAX_LIFETIME_S) {
    throw new Error(`An action's lifetime is 1 to ${MAX_LIFETIME_S} seconds`);
  }
  const iat = Math.floor(input.now);
  return {
    iss: input.did,
    sub: input.did,
    aud: input.aud,
    htm: "POST",
    htu: input.htu,
    iat,
    exp: iat + lifetime,
    jti: input.jti ?? newJti(),
    client: input.client,
    assurance: input.assurance,
    act: checked.act,
  };
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** `{did}#key-1`: the key Mosaic ID signs with, listed under `assertionMethod` (ADR-012 item 6). */
export function actionKid(did: string, fragment = "key-1"): string {
  return `${did}#${fragment}`;
}

/**
 * The compact JWS. `sign` signs the ASCII signing input with the member's Ed25519 key and returns
 * the 64-byte signature.
 */
export async function signAction(
  kid: string,
  claims: ActionClaims,
  sign: (signingInput: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  if (!kid.startsWith(`${claims.iss}#`) || kid.length === claims.iss.length + 1) {
    throw new Error("kid must be the signer's DID followed by '#' and a fragment");
  }
  const header: ActionHeader = { alg: ALG, typ: ACTION_TYP, kid };
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signature = await sign(Buffer.from(signingInput, "ascii"));
  if (signature.length !== 64) throw new Error("An Ed25519 signature is 64 bytes");
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}
