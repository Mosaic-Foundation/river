// The sign-in note's shape (spec 4.6 step 3): exactly what M8's callback will verify.
import { describe, expect, it } from "vitest";
import { generateEd25519, signEd25519, verifyEd25519 } from "../../src/identity/keys/ed25519.js";
import { NOTE_LIFETIME_SECONDS, notePayload, noteRedirect, signNote } from "../../src/identity/note.js";

const DID = "did:webvh:QmScid:id.mosaic.social:u:abcdefgh";

describe("sign-in note", () => {
  it("is a compact JWS: EdDSA, kid {did}#key-1, {iss, sub, aud, nonce, iat, exp = iat + 120}", async () => {
    const pair = generateEd25519();
    const now = new Date("2026-10-21T12:00:00.900Z");
    const payload = notePayload(DID, "https://river.mosaic.social", "n0nce-n0nce-n0nce", now);
    const jws = await signNote(`${DID}#key-1`, payload, async (data) => signEd25519(pair.privateKey, data));

    const parts = jws.split(".");
    expect(parts).toHaveLength(3);
    for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_-]+$/);
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const body = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    expect(header).toEqual({ alg: "EdDSA", kid: `${DID}#key-1` });
    expect(body).toEqual({
      iss: DID,
      sub: DID,
      aud: "https://river.mosaic.social",
      nonce: "n0nce-n0nce-n0nce",
      iat: 1792584000,
      exp: 1792584000 + 120,
    });
    expect(Object.keys(body)).toEqual(["iss", "sub", "aud", "nonce", "iat", "exp"]);
    expect(NOTE_LIFETIME_SECONDS).toBe(120);

    const signature = Buffer.from(parts[2], "base64url");
    expect(signature).toHaveLength(64);
    expect(verifyEd25519(pair.publicKey, Buffer.from(`${parts[0]}.${parts[1]}`), signature)).toBe(true);
    expect(verifyEd25519(generateEd25519().publicKey, Buffer.from(`${parts[0]}.${parts[1]}`), signature)).toBe(false);
  });

  it("returns to the exact redirect_uri with state and note", () => {
    const url = noteRedirect("http://localhost:5173/api/auth/callback", "st/ate+1", "a.b.c");
    expect(url).toBe("http://localhost:5173/api/auth/callback?state=st%2Fate%2B1&note=a.b.c");
  });
});
