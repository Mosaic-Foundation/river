// Mosaic Space Actions 0.1, reference code (docs/spec/space-actions-1.md section 8; ADR-012):
// the types, the `act` schema, the manifest reader, the JWS builder Mosaic ID uses and the
// verifier of section 4. Spaces may port it (AGPL-3.0). It makes no requests: whatever needs the
// network (the DID resolver) is handed in.
export * from "./types.js";
export { characterCount, checkAct, isHttpsIri, type ActCheck } from "./act.js";
export { readManifestActions } from "./manifest.js";
export { actionClaims, actionKid, newJti, signAction, type ClaimsInput } from "./jws.js";
export {
  DidUnavailableError,
  assertionKey,
  parseWebvhDid,
  type DidDocument,
  type DidDocumentResolver,
  type ParsedWebvhDid,
  type ResolvedDidDocument,
} from "./did.js";
export {
  FRESH_INTERVAL_S,
  PENDING_RETRY_S,
  PENDING_S,
  actKey,
  answer,
  handleAction,
  isFinal,
  refusal,
  settleClaim,
  verifyAction,
  type ActionRequest,
  type ActionStores,
  type Claimed,
  type Decide,
  type Outcome,
  type RefClaim,
  type VerifiedAction,
  type VerifyDeps,
} from "./verify.js";
export { MemoryActionStores } from "./memoryStores.js";
