// The sign-in note (spec 4.6 step 3; ADR-002): a compact JWS, alg EdDSA, header kid {did}#key-1,
// payload {iss, sub, aud, nonce, iat, exp = iat + 120}, signed with the person's key. The River's
// callback (M8) verifies it against the key in the resolved DID document. The note is never
// logged.
export const NOTE_LIFETIME_SECONDS = 120;

export interface NoteHeader {
  alg: "EdDSA";
  kid: string;
}

export interface NotePayload {
  iss: string;
  sub: string;
  aud: string;
  nonce: string;
  iat: number;
  exp: number;
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function notePayload(did: string, clientId: string, nonce: string, now: Date): NotePayload {
  const iat = Math.floor(now.getTime() / 1000);
  return { iss: did, sub: did, aud: clientId, nonce, iat, exp: iat + NOTE_LIFETIME_SECONDS };
}

/** Builds the JWS; `sign` signs the ASCII signing input with the person's key (and audits it). */
export async function signNote(
  kid: string,
  payload: NotePayload,
  sign: (signingInput: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  const header: NoteHeader = { alg: "EdDSA", kid };
  const signingInput = `${b64url(header)}.${b64url(payload)}`;
  const signature = await sign(Buffer.from(signingInput, "ascii"));
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

/** The redirect back to the River: redirect_uri?state=…&note=… */
export function noteRedirect(redirectUri: string, state: string, note: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("note", note);
  return url.toString();
}
