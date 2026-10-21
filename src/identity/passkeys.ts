// Passkey ceremonies with @simplewebauthn/server v14 (spec 4.6). RP ID from RP_ID, RP name
// "Mosaic ID", discoverable credentials only (residentKey required), user verification required,
// empty allowCredentials on sign-in, user.id = the person's random webauthn_user_id. Each
// challenge is 32 random bytes stored on an auth_requests row; verification compares against
// that row's challenge only.
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from "@simplewebauthn/server";
import { RP_NAME } from "./config.js";

const TIMEOUT_MS = 120_000;

function challengeBytes(challenge: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(challenge, "base64url"));
}

export async function registrationOptions(o: {
  rpId: string;
  challenge: string;
  userId: Buffer;
  userName: string;
  displayName: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: o.rpId,
    userID: new Uint8Array(o.userId),
    userName: o.userName,
    userDisplayName: o.displayName,
    challenge: challengeBytes(o.challenge),
    timeout: TIMEOUT_MS,
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
    // Ed25519, P-256, RS256: the library's defaults.
    supportedAlgorithmIDs: [-8, -7, -257],
  });
}

export async function authenticationOptions(o: {
  rpId: string;
  challenge: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID: o.rpId,
    challenge: challengeBytes(o.challenge),
    timeout: TIMEOUT_MS,
    allowCredentials: [],
    userVerification: "required",
  });
}

export type RegisteredCredential = WebAuthnCredential;

/** The new credential, or undefined when the response doesn't verify against `challenge`. */
export async function verifyRegistration(o: {
  response: unknown;
  challenge: string;
  origin: string;
  rpId: string;
}): Promise<RegisteredCredential | undefined> {
  if (!isCredentialJson(o.response)) return undefined;
  try {
    const result = await verifyRegistrationResponse({
      response: o.response as RegistrationResponseJSON,
      expectedChallenge: o.challenge,
      expectedOrigin: o.origin,
      expectedRPID: o.rpId,
      requireUserVerification: true,
    });
    return result.verified ? result.registrationInfo.credential : undefined;
  } catch {
    return undefined;
  }
}

/** The credential id an assertion names, before anything is verified (for the person lookup). */
export function assertionCredentialId(response: unknown): string | undefined {
  if (!isCredentialJson(response)) return undefined;
  const id = (response as { id: string }).id;
  return /^[A-Za-z0-9_-]{16,1364}$/.test(id) ? id : undefined;
}

/** The new signature counter, or undefined when the assertion doesn't verify against `challenge`. */
export async function verifyAssertion(o: {
  response: unknown;
  challenge: string;
  origin: string;
  rpId: string;
  credential: RegisteredCredential;
}): Promise<number | undefined> {
  if (!isCredentialJson(o.response)) return undefined;
  try {
    const result = await verifyAuthenticationResponse({
      response: o.response as AuthenticationResponseJSON,
      expectedChallenge: o.challenge,
      expectedOrigin: o.origin,
      expectedRPID: o.rpId,
      credential: o.credential,
      requireUserVerification: true,
    });
    return result.verified ? result.authenticationInfo.newCounter : undefined;
  } catch {
    return undefined;
  }
}

function isCredentialJson(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.rawId === "string" && v.type === "public-key" &&
    typeof v.response === "object" && v.response !== null;
}
