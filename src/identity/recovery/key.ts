// The private half of Mosaic's recovery key (spec 4.6; ADR-002). It lives offline with Adam and
// reaches `npm run recover-dids` only from a file outside the repository or from a prompt, never
// from the repo or an environment variable (nothing here reads process.env). The key is an
// Ed25519 private key in PKCS#8 PEM, as `openssl genpkey -algorithm ed25519` writes it.
import { createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { signEd25519, toMultikey } from "../keys/ed25519.js";

export interface RecoveryKey {
  /** The public half, as listed in every DID's update keys. */
  multikey: string;
  sign(data: Uint8Array): Promise<Buffer>;
}

export function recoveryKeyFromPem(pem: string): RecoveryKey {
  let privateKey: KeyObject;
  try {
    privateKey = createPrivateKey({ key: pem, format: "pem" });
  } catch {
    throw new Error("That is not a PEM private key");
  }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("The recovery key must be an Ed25519 key");
  const multikey = toMultikey(createPublicKey(privateKey));
  return { multikey, sign: async (data) => signEd25519(privateKey, data) };
}

/**
 * Reads the key from a file. Refuses a file inside `repoRoot` (default: the current directory, where
 * npm runs the script), so a key can't be used from, or left in, the working tree.
 */
export async function recoveryKeyFromFile(file: string, repoRoot = process.cwd()): Promise<RecoveryKey> {
  const resolved = path.resolve(file);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Keep the recovery key outside the repository; pass a path outside it.");
  }
  return recoveryKeyFromPem(await readFile(resolved, "utf8"));
}

/** Asks for the PEM on the terminal (paste it, ending with its END line). */
export async function recoveryKeyFromPrompt(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stderr,
): Promise<RecoveryKey> {
  output.write("Paste the recovery private key (PEM), then press Enter:\n");
  const rl = createInterface({ input, terminal: false });
  const lines: string[] = [];
  try {
    for await (const line of rl) {
      lines.push(line);
      if (/^-----END [A-Z ]*PRIVATE KEY-----$/.test(line.trim())) break;
    }
  } finally {
    rl.close();
  }
  return recoveryKeyFromPem(lines.join("\n"));
}
