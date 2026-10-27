// The River's envelope encryption for the credentials it holds to act for members (ADR-010 §5):
// its own copy of the scheme (src/river/acting/crypto/envelope.ts) and the row-bound sealing on
// top of it (credentials.ts).
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CURRENT_KEY_VERSION,
  clientAad,
  credentialAad,
  openClientSecret,
  openCredential,
  sealClientSecret,
  sealCredential,
  type CredentialRow,
} from "../../src/river/acting/crypto/credentials.js";
import { openValue, parseMasterKey, sealValue } from "../../src/river/acting/crypto/envelope.js";

const TOKEN = "ZA-9mJ3hZ0ExampleAccessTokenValue_Qx";

function row(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return {
    instanceId: "00000000-0000-4000-8000-000000000001",
    accountId: randomUUID(),
    rowId: randomUUID(),
    purpose: "fediverse_token",
    ...overrides,
  };
}

describe("envelope (the River's copy)", () => {
  it("round-trips under the master key; the wrapped data key is 60 bytes", () => {
    const master = randomBytes(32);
    const plaintext = Buffer.from("a secret value");
    const box = sealValue(master, "aad", plaintext);
    expect(box.wrappedDek).toHaveLength(12 + 16 + 32);
    expect(box.ciphertext).toHaveLength(12 + 16 + plaintext.length);
    expect(openValue(master, "aad", box).equals(plaintext)).toBe(true);
  });

  it("fails with another master key, other additional data, or any flipped byte", () => {
    const master = randomBytes(32);
    const box = sealValue(master, "row-a", Buffer.from("a secret value"));
    expect(() => openValue(randomBytes(32), "row-a", box)).toThrow(/wrapped data key failed/);
    expect(() => openValue(master, "row-b", box)).toThrow(/failed to decrypt/);
    for (const field of ["ciphertext", "wrappedDek"] as const) {
      for (const index of [0, 13, box[field].length - 1]) {
        const tampered = { ...box, [field]: Buffer.from(box[field]) };
        tampered[field][index] ^= 1;
        expect(() => openValue(master, "row-a", tampered), `${field}[${index}]`).toThrow(/failed to decrypt/);
      }
    }
    expect(() => openValue(master, "row-a", { ...box, ciphertext: box.ciphertext.subarray(0, 20) })).toThrow(/too short/);
  });

  it("refuses empty additional data", () => {
    expect(() => sealValue(randomBytes(32), "", Buffer.from("x"))).toThrow(/must not be empty/);
  });

  it("reads a master key as base64 of exactly 32 bytes, naming the variable and never echoing it", () => {
    const key = randomBytes(32);
    expect(parseMasterKey("RIVER_TOKEN_KEY", ` ${key.toString("base64")}\n`).equals(key)).toBe(true);
    const short = randomBytes(16).toString("base64");
    expect(() => parseMasterKey("RIVER_TOKEN_KEY", short)).toThrow(/RIVER_TOKEN_KEY must decode to exactly 32 bytes/);
    try {
      parseMasterKey("RIVER_TOKEN_KEY", short);
    } catch (err) {
      expect((err as Error).message).not.toContain(short);
    }
    expect(() => parseMasterKey("RIVER_TOKEN_KEY", "not base64!")).toThrow(/must be base64/);
  });
});

describe("credentials sealed under RIVER_TOKEN_KEY", () => {
  beforeEach(() => {
    vi.stubEnv("RIVER_TOKEN_KEY", randomBytes(32).toString("base64"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds a member's credential to its instance, account, row and purpose (ADR-010 §5's format)", () => {
    const r = row();
    expect(credentialAad(r)).toBe(`river-token:v1|${r.instanceId}|${r.accountId}|${r.rowId}|fediverse_token`);
    const stored = sealCredential(r, TOKEN);
    expect(stored.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(openCredential(r, stored)).toBe(TOKEN);
    for (const other of [
      { ...r, instanceId: "00000000-0000-4000-8000-0000000000e2" },
      { ...r, accountId: randomUUID() },
      { ...r, rowId: randomUUID() },
      { ...r, purpose: "grant_token" as const },
    ]) {
      expect(() => openCredential(other, stored)).toThrow(/failed to decrypt/);
    }
  });

  it("binds a client secret to its instance and server host", () => {
    const r = { instanceId: "00000000-0000-4000-8000-000000000001", host: "example.social" };
    expect(clientAad(r)).toBe(`river-client:v1|${r.instanceId}|example.social`);
    const stored = sealClientSecret(r, TOKEN);
    expect(openClientSecret(r, stored)).toBe(TOKEN);
    expect(() => openClientSecret({ ...r, host: "other.example" }, stored)).toThrow(/failed to decrypt/);
    // A client secret's ciphertext can't be opened as a member's credential either.
    expect(() => openCredential(row(), stored)).toThrow(/failed to decrypt/);
  });

  it("holds no plaintext in the stored bytes", () => {
    const stored = sealCredential(row(), TOKEN);
    for (const blob of [stored.ciphertext, stored.wrappedDek]) {
      expect(blob.includes(Buffer.from(TOKEN))).toBe(false);
      expect(blob.toString("latin1")).not.toContain(TOKEN.slice(0, 8));
    }
  });

  it("opens nothing after the key changes, and says which variable without echoing values", () => {
    const r = row();
    const stored = sealCredential(r, TOKEN);
    vi.stubEnv("RIVER_TOKEN_KEY", randomBytes(32).toString("base64"));
    let message = "";
    try {
      openCredential(r, stored);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/failed to decrypt/);
    expect(message).not.toContain(TOKEN);
  });

  it("refuses an unknown key version, malformed ids and hosts, unknown purposes and empty values", () => {
    const r = row();
    const stored = sealCredential(r, TOKEN);
    expect(() => openCredential(r, { ...stored, keyVersion: 2 })).toThrow(/key version 2/);
    expect(() => sealCredential({ ...r, accountId: "not-a-uuid" }, TOKEN)).toThrow(/accountId/);
    expect(() => sealCredential({ ...r, rowId: r.rowId.toUpperCase() }, TOKEN)).toThrow(/rowId/);
    expect(() => sealCredential({ ...r, purpose: "password" as never }, TOKEN)).toThrow(/purpose/);
    expect(() => sealCredential(r, "")).toThrow(/empty/);
    expect(() => sealClientSecret({ instanceId: r.instanceId, host: "Example.Social" }, TOKEN)).toThrow(/host/);
    expect(() => sealClientSecret({ instanceId: r.instanceId, host: "a.example|b" }, TOKEN)).toThrow(/host/);
  });

  it("needs RIVER_TOKEN_KEY only when a credential is sealed or opened", () => {
    vi.stubEnv("RIVER_TOKEN_KEY", "");
    expect(() => sealCredential(row(), TOKEN)).toThrow(/Missing required environment variable RIVER_TOKEN_KEY/);
    vi.stubEnv("RIVER_TOKEN_KEY", randomBytes(31).toString("base64"));
    expect(() => sealCredential(row(), TOKEN)).toThrow(/RIVER_TOKEN_KEY must decode to exactly 32 bytes/);
  });
});
