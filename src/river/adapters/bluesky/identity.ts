// atproto identity (ADR-009 item 2; atproto handle and DID specs): a handle resolves to a DID, the
// DID resolves to a document, and the handle counts only when the document names it back in
// `alsoKnownAs`. Handles change; the DID is the account.
//
//   - Handle to DID: the AppView's com.atproto.identity.resolveHandle (it checks the `_atproto`
//     DNS TXT record and the HTTPS document); when it can't, the handle's own
//     https://{handle}/.well-known/atproto-did through the guard. The River makes no TXT lookup of
//     its own: the guard resolves addresses only.
//   - DID to document: did:plc at https://plc.directory/{did}; did:web at
//     https://{domain}/.well-known/did.json.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES } from "../../../shared/items/index.js";
import { get, httpsUrl, isObject, list, PLC_DIRECTORY, replyError, str, xrpcUrl } from "./http.js";
import { didWebHost, normalizeDid, normalizeHandle } from "./input.js";

export interface DidDocument {
  did: string;
  /** Handles the document claims (`at://{handle}` in alsoKnownAs), normalized, in order. */
  handles: string[];
  /** The account's PDS (`#atproto_pds`), when listed. */
  pds?: string;
}

function notASpace(): AdapterError {
  return new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
}

/** The handle's own HTTPS document: its body is the DID, as plain text. */
async function wellKnownDid(guard: FetchGuard, handle: string): Promise<string | undefined> {
  const reply = await get(guard, `https://${handle}/.well-known/atproto-did`, "text/plain");
  if (reply.status !== 200 || reply.text === undefined) return undefined;
  return normalizeDid(reply.text.trim());
}

/** Handle to DID: the AppView first, then the handle's well-known document. Not yet verified. */
export async function resolveHandle(guard: FetchGuard, handle: string): Promise<string> {
  let appViewError: AdapterError | undefined;
  try {
    const reply = await get(guard, xrpcUrl("com.atproto.identity.resolveHandle", { handle }));
    if (reply.status === 200 && isObject(reply.body)) {
      const did = normalizeDid(str(reply.body.did) ?? "");
      if (did) return did;
    }
    appViewError = reply.status === 200 ? notASpace() : replyError(reply);
  } catch (err) {
    appViewError = err instanceof AdapterError ? err : notASpace();
  }
  // The AppView couldn't say (it doesn't know the handle, or didn't answer): ask the handle itself.
  try {
    const did = await wellKnownDid(guard, handle);
    if (did) return did;
  } catch (err) {
    // A handle whose host the guard refuses can't be followed, whatever the AppView said.
    if (err instanceof AdapterError && err.reason === "refused") throw err;
  }
  throw appViewError;
}

/** Reads a DID document (did:plc from the PLC directory, did:web from its domain). */
export async function readDidDocument(guard: FetchGuard, did: string): Promise<DidDocument> {
  const web = didWebHost(did);
  const url = web ? `https://${web}/.well-known/did.json` : `${PLC_DIRECTORY}/${did}`;
  const reply = await get(guard, url);
  if (reply.status === 404 || reply.status === 410) throw notASpace();
  if (reply.status !== 200) throw replyError(reply);
  const doc = reply.body;
  if (!isObject(doc) || doc.id !== did) throw notASpace();
  const handles = list(doc.alsoKnownAs)
    .map((aka) => str(aka))
    .filter((aka): aka is string => aka !== undefined && aka.startsWith("at://"))
    .map((aka) => normalizeHandle(aka.slice("at://".length)))
    .filter((h): h is string => h !== undefined);
  const service = list(doc.service).find(
    (s) => isObject(s) && (s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`) && s.type === "AtprotoPersonalDataServer",
  );
  const pds = isObject(service) ? httpsUrl(service.serviceEndpoint) : undefined;
  return { did, handles, ...(pds ? { pds } : {}) };
}

/**
 * A handle, resolved and verified both ways: the DID it points to, whose document names it back.
 * A handle the document doesn't claim isn't that account's (anyone can point a name at a DID).
 */
export async function resolveVerifiedHandle(guard: FetchGuard, handle: string): Promise<DidDocument> {
  const did = await resolveHandle(guard, handle);
  const doc = await readDidDocument(guard, did);
  if (!doc.handles.includes(handle)) throw notASpace();
  return doc;
}
