// The conformance suite against the reference verifier (space-actions-1 section 8; check 1):
// every vector in tests/conformance/space-actions/vectors.json gets its expected answer, steps 1
// to 4 refuse without reading a DID log, and the host cases (the dot boundary) hold for the
// shared host-list check. The file must match its builder, so it can't drift.
import { describe, expect, it } from "vitest";
import { hostInList } from "../../src/shared/hosts/index.js";
import {
  MemoryActionStores,
  answer,
  handleAction,
  readManifestActions,
  type Decide,
} from "../../src/shared/spaceActions/index.js";
import { actionId, buildVectors } from "../conformance/space-actions/generate.js";
import { checkHosts, loadVectors, runSuite, type Target, type Vectors } from "../conformance/space-actions/suite.js";
import { MapDidResolver } from "../support/spaceActions/testDid.js";

const vectors = loadVectors();

/** The reference verifier with in-memory stores, accepting every valid action. */
function referenceTarget(v: Vectors, didHosts?: string[]): Target {
  const manifest = readManifestActions(v.manifest, v.manifest_url);
  if (!manifest) throw new Error("The vectors' manifest doesn't read");
  if (didHosts) manifest.did_hosts = didHosts;
  const resolver = new MapDidResolver(() => v.now * 1000);
  for (const did of v.dids) resolver.logs.set(did.log_url, did.log);
  const stores = new MemoryActionStores();
  const decide: Decide = async ({ claims }) =>
    answer({ status: "accepted", id: actionId(claims.act.ref), withdrawable: true, ref: claims.act.ref });
  return {
    async send({ contentType, body }) {
      const outcome = await handleAction({ contentType, body }, { manifest, resolver, stores, now: () => v.now }, decide);
      return { status: outcome.status, body: JSON.parse(JSON.stringify(outcome.body)) };
    },
    didRequests: () => resolver.requests.length,
  };
}

describe("the vectors file", () => {
  it("matches its builder (npx tsx scripts/space-actions-vectors.ts)", async () => {
    expect(JSON.stringify(await buildVectors())).toBe(JSON.stringify(vectors));
  });

  it("has a valid case per verb and a case per refusal a request alone can trigger", () => {
    const names = vectors.cases.map((c) => c.name);
    const verbOf = (body: string) =>
      (JSON.parse(Buffer.from(body.split(".")[1]!, "base64url").toString()) as { act: { verb: string } }).act.verb;
    const validVerbs = new Set(vectors.cases.filter((c) => c.step === 0).flatMap((c) => c.requests.map((r) => verbOf(r.body))));
    expect([...validVerbs].sort()).toEqual(["comment", "poll_answer", "rsvp", "support", "withdraw"]);
    const codes = new Set(vectors.cases.flatMap((c) => c.requests.map((r) => r.expect.code)).filter(Boolean));
    expect([...codes].sort()).toEqual(
      ["bad_signature", "bad_type", "expired", "invalid_action", "malformed", "ref_conflict", "replayed", "untrusted_did", "wrong_audience"].sort(),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("has the four civic.social host cases", () => {
    const civic = vectors.hosts.filter((h) => h.list.join() === "civic.social").map((h) => [h.host, h.matches]);
    expect(civic).toEqual(
      expect.arrayContaining([
        ["civic.social", true],
        ["floyd.civic.social", true],
        ["evilcivic.social", false],
        ["civic.social.example.com", false],
      ]),
    );
  });
});

describe("the reference verifier", () => {
  it("passes every case", async () => {
    const failures = (await runSuite(referenceTarget(vectors), vectors)).filter((r) => !r.ok);
    expect(failures).toEqual([]);
  });

  it("passes every host case", () => {
    expect(checkHosts(hostInList, vectors)).toEqual([]);
  });
});

describe("the suite catches", () => {
  it("a text suffix check on hosts", () => {
    const endsWith = (host: string, list: readonly string[]) => list.some((entry) => host.toLowerCase().endsWith(entry));
    expect(checkHosts(endsWith, vectors).map((h) => h.host)).toContain("evilcivic.social");
  });

  it("a space that trusts too broad a DID host", async () => {
    const results = await runSuite(referenceTarget(vectors, ["test.example"]), vectors);
    expect(results.filter((r) => !r.ok).map((r) => r.name)).toEqual(["untrusted-did-no-dot-boundary"]);
  });
});
