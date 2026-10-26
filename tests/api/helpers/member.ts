// Signs members in to the running dev server through the River's real callback, as
// tests/api/signin.test.ts and tests/api/following.test.ts do: a test did:webvh whose log this
// helper serves on :3005 (in the dev server's TRUSTED_DID_HOSTS, read over loopback because
// TEST_DID_LOOPBACK=1), and a note signed with its key. Each call to signIn() is a new member.
import { generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from "node:crypto";
import http from "node:http";
import { createDID, MultibaseEncoding, multibaseEncode, prepareDataForSigning, type Signer } from "didwebvh-ts";

export const API = process.env.API_URL ?? "http://localhost:3000";
const PORT = 3005;
const SESSION = "__Host-river-session";
const STATE = "__Host-river-signin";

export interface Member {
  did: string;
  /** `__Host-river-session=…`, for a Cookie header. */
  cookie: string;
  /** The River's public origin, for the Origin header of writes. */
  origin: string;
}

/** Serves the DID logs of the members this helper signs in. Start it in beforeAll, close it in afterAll. */
export class DidLogServer {
  private readonly logs = new Map<string, string>();
  private server: http.Server | undefined;

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => {
      const body = this.logs.get(req.url ?? "");
      if (body === undefined) res.writeHead(404).end();
      else res.writeHead(200, { "content-type": "text/jsonl" }).end(body);
    });
    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(PORT, () => resolve());
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  /** A did:webvh like the identity host's, served from this server. */
  private async testDid(): Promise<{ did: string; privateKey: KeyObject }> {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const raw = Buffer.from(publicKey.export({ format: "jwk" }).x ?? "", "base64url");
    const multikey = multibaseEncode(new Uint8Array([0xed, 0x01, ...raw]), MultibaseEncoding.BASE58_BTC);
    const code = randomBytes(5).toString("hex").slice(0, 8);
    const id = `did:webvh:{SCID}:localhost%3A${PORT}:u:${code}`;
    const signer: Signer = {
      getVerificationMethodId: () => `did:key:${multikey}#${multikey}`,
      async sign({ document, proof }) {
        const data = await prepareDataForSigning(document, proof);
        return { proofValue: multibaseEncode(new Uint8Array(edSign(null, data, privateKey)), MultibaseEncoding.BASE58_BTC) };
      },
    };
    const result = await createDID({
      address: `localhost:${PORT}`,
      paths: ["u", code],
      signer,
      verifier: { verify: async () => true },
      updateKeys: [multikey],
      didDocument: {
        "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/multikey/v1"],
        id,
        controller: id,
        verificationMethod: [{ id: `${id}#key-1`, type: "Multikey", controller: id, publicKeyMultibase: multikey }],
        authentication: [`${id}#key-1`],
      },
      portable: true,
      witness: null,
      watchers: null,
      created: `${new Date(Date.now() - 60_000).toISOString().slice(0, 19)}Z`,
    });
    this.logs.set(`/u/${code}/did.jsonl`, result.log.map((entry) => `${JSON.stringify(entry)}\n`).join(""));
    return { did: result.did, privateKey };
  }

  /** Signs a new member in through GET /auth/signin and the River's callback. */
  async signIn(): Promise<Member> {
    const who = await this.testDid();
    const started = await fetch(`${API}/auth/signin`, { redirect: "manual" });
    const url = new URL(started.headers.get("location") ?? "");
    const state = url.searchParams.get("state") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const origin = new URL(url.searchParams.get("client_id") ?? "").origin;
    const stateCookie = (started.headers.getSetCookie().find((c) => c.startsWith(`${STATE}=`)) ?? "").split(";")[0] ?? "";
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: "EdDSA", kid: `${who.did}#key-1` })}.${b64({ iss: who.did, sub: who.did, aud: origin, nonce, iat: now, exp: now + 120 })}`;
    const jws = `${input}.${edSign(null, Buffer.from(input, "ascii"), who.privateKey).toString("base64url")}`;
    const res = await fetch(`${API}/auth/callback?${new URLSearchParams({ state, note: jws })}`, {
      redirect: "manual",
      headers: { cookie: stateCookie },
    });
    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION}=`) && !c.startsWith(`${SESSION}=;`));
    if (res.status !== 303 || !session) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    return { did: who.did, cookie: session.split(";")[0] ?? "", origin };
  }
}

/** Fails with a clear message when the dev server isn't running. */
export async function requireApi(): Promise<void> {
  try {
    await fetch(`${API}/health`);
  } catch {
    throw new Error(`No API at ${API}. Start it with \`npm run dev\` (see tests/api/README.md).`);
  }
  // Each file starts with the sign-in limits clear (TEST_ROUTES): the suite signs in from one address.
  await fetch(`${API}/test/rate-limits/reset`, { method: "POST" });
}
