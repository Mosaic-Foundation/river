// Resolve (ADR-009 item 2): what was typed to a DID, verified, and the profile for the preview
// (name, avatar, bio). A handle must resolve to a DID whose document names it back; a DID typed
// directly takes its handle from the profile when the document names that handle too.
import type { FetchGuard } from "../../../shared/fetch/index.js";
import { AdapterError, ADAPTER_MESSAGES, type SpacePreview } from "../../../shared/items/index.js";
import { toPlainText } from "../../../shared/sanitize/index.js";
import { httpsUrl, str, xrpc, type Json } from "./http.js";
import { readDidDocument, resolveVerifiedHandle, type DidDocument } from "./identity.js";
import { canonicalUrlFor, normalizeDid, normalizeHandle, parseInput, profileUrl } from "./input.js";
import { actorFrom, toManifestJson, type BlueskyManifest } from "./manifest.js";
import { hidesFromVisitors } from "./map.js";

/** Longest bio kept for the preview. */
const MAX_BIO = 500;

/** `app.bsky.actor.getProfile`; the profile must be the DID's. */
export async function getProfile(guard: FetchGuard, did: string): Promise<Json> {
  const profile = await xrpc(guard, "app.bsky.actor.getProfile", { actor: did });
  if (normalizeDid(str(profile.did) ?? "") !== did) {
    throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  }
  return profile;
}

/** The handle to show: the one typed (already verified), else the profile's if the document claims it. */
function verifiedHandle(doc: DidDocument, typed: string | undefined, profile: Json): string | undefined {
  if (typed) return typed;
  const fromProfile = normalizeHandle(str(profile.handle) ?? "");
  return fromProfile && doc.handles.includes(fromProfile) ? fromProfile : undefined;
}

/** A preview from a verified DID document and its profile. */
export function previewFrom(doc: DidDocument, profile: Json, typedHandle: string | undefined, now: Date): SpacePreview {
  if (hidesFromVisitors(profile)) {
    // The owner asked not to be shown to people who aren't signed in to Bluesky (ADR-009 item 4).
    throw new AdapterError("refused", ADAPTER_MESSAGES.refused);
  }
  const handle = verifiedHandle(doc, typedHandle, profile);
  const displayName = toPlainText(str(profile.displayName)).slice(0, 200) || undefined;
  const avatar = httpsUrl(profile.avatar);
  const description = toPlainText(str(profile.description)).slice(0, MAX_BIO) || undefined;
  const actor = actorFrom({ did: doc.did, handle, displayName, avatar }, now);
  const manifest: BlueskyManifest = {
    actor,
    ...(description ? { description } : {}),
    ...(doc.pds ? { pds: doc.pds } : {}),
  };
  return {
    adapter: "atproto",
    canonicalUrl: canonicalUrlFor(doc.did),
    name: displayName ?? handle ?? doc.did,
    ...(avatar ? { iconUrl: avatar } : {}),
    ...(description ? { description } : {}),
    homeUrl: profileUrl(doc.did),
    actorId: doc.did,
    network: "bluesky",
    category: "person",
    manifest: toManifestJson(manifest),
  };
}

export async function resolve(input: string, guard: FetchGuard, now: Date): Promise<SpacePreview> {
  const parsed = parseInput(input);
  if (!parsed) throw new AdapterError("not_a_space", ADAPTER_MESSAGES.not_a_space);
  const doc =
    parsed.kind === "handle" ? await resolveVerifiedHandle(guard, parsed.handle) : await readDidDocument(guard, parsed.did);
  const profile = await getProfile(guard, doc.did);
  return previewFrom(doc, profile, parsed.kind === "handle" ? parsed.handle : undefined, now);
}
