// A visitor's River (spec 2 "Visitor", F1, F5, F9): the instance's seed follows, read-only, with
// the instance's default circles as the visitor's circles. Nothing about a visitor is stored; read
// state lives in their browser (check 23).
//
// The scope logic is shared shape with members (M8/M9): a list of follows (whole spaces or single
// streams), a list of circles naming spaces, and one civic-role circle. Only where those lists come
// from differs.
import type { DefaultCircle, Instance } from "../instances.js";
import { FeedInputError, type FeedScope } from "./query.js";
import type { SpaceRow } from "./spaces.js";

export const MODES = ["everything", "civic"] as const;
export type Mode = (typeof MODES)[number];

/** A reader's circle, as the feed returns it. Visitor circles are named by their name. */
export interface ReaderCircle {
  id: string;
  name: string;
  color: string | null;
  role: "civic" | null;
  spaceIds: string[];
}

export interface ReaderFollow {
  spaceId: string;
  /** Set for a single-stream follow. */
  streamKey?: string;
}

export interface ReaderView {
  follows: ReaderFollow[];
  /** Streams muted inside followed spaces (members only; spec F7). */
  mutes?: Array<{ spaceId: string; streamKey: string }>;
  circles: ReaderCircle[];
  /** Category of every followed space, for the civic mode's scope. */
  categories: Map<string, string | null>;
}

/** The visitor's follows and circles, given the stored space for each followed name. */
export function visitorView(instance: Instance, spaces: Map<string, SpaceRow>): ReaderView {
  const follows: ReaderFollow[] = [];
  const categories = new Map<string, string | null>();
  for (const seed of instance.seedFollows) {
    const space = spaces.get(seed.url);
    if (!space) continue;
    categories.set(space.id, space.category);
    follows.push(seed.stream_key ? { spaceId: space.id, streamKey: seed.stream_key } : { spaceId: space.id });
  }
  const circles = instance.defaultCircles.map((circle: DefaultCircle) => ({
    id: circle.name,
    name: circle.name,
    color: circle.color ?? null,
    role: circle.role === "civic" ? ("civic" as const) : null,
    spaceIds: circle.members.map((m) => spaces.get(m)?.id).filter((id): id is string => Boolean(id)),
  }));
  return { follows, circles, categories };
}

export function parseMode(raw: string | undefined, instance: Instance): Mode {
  const value = raw === undefined || raw === "" ? instance.defaultMode : raw.toLowerCase();
  if (!(MODES as readonly string[]).includes(value) || !instance.modesEnabled.includes(value)) {
    throw new FeedInputError("mode", `Mode "${raw}" isn't enabled here`);
  }
  return value as Mode;
}

/**
 * The scope after the circle and the mode (spec F5, F9): circle (one at a time) AND the mode's
 * scope. Civic mode keeps spaces with category civic plus members of the civic-role circle.
 */
export function scopeFor(view: ReaderView, mode: Mode, circleId: string | undefined): FeedScope {
  let circle: ReaderCircle | undefined;
  if (circleId !== undefined && circleId !== "" && circleId.toLowerCase() !== "all") {
    circle = view.circles.find((c) => c.id === circleId);
    if (!circle) throw new FeedInputError("circle", `Unknown circle "${circleId}"`);
  }
  const civicCircle = view.circles.find((c) => c.role === "civic");
  const allowed = (spaceId: string): boolean => {
    if (circle && !circle.spaceIds.includes(spaceId)) return false;
    if (mode === "civic") {
      return view.categories.get(spaceId) === "civic" || Boolean(civicCircle?.spaceIds.includes(spaceId));
    }
    return true;
  };
  const scope: FeedScope = { spaceIds: [], streams: [], mutedStreams: [] };
  for (const follow of view.follows) {
    if (!allowed(follow.spaceId)) continue;
    if (follow.streamKey) scope.streams.push({ spaceId: follow.spaceId, key: follow.streamKey });
    else if (!scope.spaceIds.includes(follow.spaceId)) scope.spaceIds.push(follow.spaceId);
  }
  // The most specific rule wins (spec F7): a muted stream stays hidden inside a followed space,
  // and a followed stream shows even when its space isn't followed (one rule per stream, so a
  // stream is never both).
  for (const mute of view.mutes ?? []) {
    if (scope.spaceIds.includes(mute.spaceId)) scope.mutedStreams!.push({ spaceId: mute.spaceId, key: mute.streamKey });
  }
  return scope;
}
