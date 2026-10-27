// A manifest's `actions` block (space-actions-1 2.1), read the way a client must read it: a block
// with another `protocol`, or an `endpoint` that isn't https on the manifest's own host, is
// ignored whole. Unknown verbs are dropped, entries of `did_hosts` that aren't plain hosts are
// dropped (they would match nothing), and `join` and `terms` are kept only as https links.
import { isHostEntry } from "../hosts/index.js";
import { isHttpsIri } from "./act.js";
import { PROTOCOL, VERBS, type ManifestActions, type Verb } from "./types.js";

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * The manifest's `actions` block, checked against the manifest's own URL, or undefined when the
 * block is missing or must be ignored.
 */
export function readManifestActions(manifest: unknown, manifestUrl: string): ManifestActions | undefined {
  const block = object(object(manifest)?.actions);
  if (!block || block.protocol !== PROTOCOL) return undefined;

  let origin: URL;
  try {
    origin = new URL(manifestUrl);
  } catch {
    return undefined;
  }
  if (origin.protocol !== "https:") return undefined;
  // The endpoint is `htu` exactly, so it carries no fragment.
  if (!isHttpsIri(block.endpoint) || block.endpoint.includes("#") || new URL(block.endpoint).host !== origin.host) {
    return undefined;
  }

  // `audience` is the space's id when it has one, else its origin.
  const spaceId = object(object(manifest)?.space)?.id;
  const expectedAudience = typeof spaceId === "string" && spaceId !== "" ? spaceId : origin.origin;
  if (block.audience !== expectedAudience) return undefined;

  const didHosts = Array.isArray(block.did_hosts)
    ? block.did_hosts.filter((host): host is string => isHostEntry(host)).map((host) => host.toLowerCase())
    : [];
  const verbs = Array.isArray(block.verbs)
    ? [...new Set(block.verbs.filter((verb): verb is Verb => (VERBS as readonly unknown[]).includes(verb)))]
    : [];

  const result: ManifestActions = {
    protocol: PROTOCOL,
    endpoint: block.endpoint,
    audience: expectedAudience,
    did_hosts: didHosts,
    verbs,
  };
  if (isHttpsIri(block.join)) result.join = block.join;
  if (isHttpsIri(block.terms)) result.terms = block.terms;
  return result;
}
