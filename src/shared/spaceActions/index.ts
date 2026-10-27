// Mosaic Space Actions 0.1, reference code (docs/spec/space-actions-1.md section 8; ADR-012):
// the types, the `act` schema, the manifest reader and the JWS builder Mosaic ID uses. Spaces may
// port it (AGPL-3.0). It makes no requests: whatever needs the network is handed in.
export * from "./types.js";
export { characterCount, checkAct, isHttpsIri, type ActCheck } from "./act.js";
export { readManifestActions } from "./manifest.js";
export { actionClaims, actionKid, newJti, signAction, type ClaimsInput } from "./jws.js";
