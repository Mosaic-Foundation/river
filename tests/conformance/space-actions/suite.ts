// The Mosaic Space Actions 0.1 conformance suite (space-actions-1 section 8). It runs
// vectors.json against any verifier given as a `send` function: the reference verifier in unit
// tests (tests/unit/spaceActionsConformance.test.ts), the stand-in space, and later a real space's
// endpoint. It doesn't depend on Vitest, so a command-line runner can use it too.
//
// A target must run at the vectors' fixed clock (`now`), trust the vectors' DID host, resolve
// the vectors' DID logs from `log_url`, and accept every valid action on the vectors' targets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { HostVector, VectorCase, Vectors } from "./types.js";

export type { HostVector, VectorCase, VectorDid, VectorRequest, Vectors } from "./types.js";

export const VECTORS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "vectors.json");

export function loadVectors(file = VECTORS_PATH): Vectors {
  return JSON.parse(fs.readFileSync(file, "utf8")) as Vectors;
}

/** One answer from the space under test. */
export interface TargetAnswer {
  status: number;
  /** The parsed JSON body (a 3.5 answer or problem document), or undefined. */
  body: unknown;
}

export interface Target {
  send(request: { contentType: string; body: string }): Promise<TargetAnswer>;
  /** DID log requests the target has made so far, if it can count them (check 1). */
  didRequests?(): number;
}

export interface CaseResult {
  name: string;
  step: number;
  ok: boolean;
  /** What went wrong, per request, when not ok. */
  problems: string[];
}

function codeOf(body: unknown): unknown {
  return body !== null && typeof body === "object" ? (body as Record<string, unknown>).code : undefined;
}

/** Runs one case's requests in order against the target. */
export async function runCase(target: Target, vectorCase: VectorCase): Promise<CaseResult> {
  const problems: string[] = [];
  const answers: TargetAnswer[] = [];
  for (const [i, request] of vectorCase.requests.entries()) {
    const before = target.didRequests?.();
    const got = await target.send({ contentType: request.content_type, body: request.body });
    answers.push(got);
    const want = request.expect;
    if (got.status !== want.status) problems.push(`request ${i}: status ${got.status}, expected ${want.status}`);
    if (want.code !== undefined && codeOf(got.body) !== want.code) {
      problems.push(`request ${i}: code ${String(codeOf(got.body))}, expected ${want.code}`);
    }
    if (want.code === undefined && got.status < 300 && !["accepted", "held"].includes(String((got.body as { status?: unknown })?.status))) {
      problems.push(`request ${i}: answer status is neither accepted nor held`);
    }
    if (want.no_did_request && before !== undefined && target.didRequests?.() !== before) {
      problems.push(`request ${i}: the DID log was read before refusing`);
    }
    if (want.same_as !== undefined && JSON.stringify(got) !== JSON.stringify(answers[want.same_as])) {
      problems.push(`request ${i}: answer differs from request ${want.same_as}'s`);
    }
  }
  return { name: vectorCase.name, step: vectorCase.step, ok: problems.length === 0, problems };
}

/** Runs every case, in file order, against one target. */
export async function runSuite(target: Target, vectors: Vectors = loadVectors()): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const vectorCase of vectors.cases) results.push(await runCase(target, vectorCase));
  return results;
}

/** Checks a host-list implementation against the `hosts` vectors; returns the ones it gets wrong. */
export function checkHosts(matches: (host: string, list: readonly string[]) => boolean, vectors: Vectors = loadVectors()): HostVector[] {
  return vectors.hosts.filter((vector) => matches(vector.host, vector.list) !== vector.matches);
}
