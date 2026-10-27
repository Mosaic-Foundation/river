// The stand-in space (space-actions-1 section 8; ADR-012 item 10): a small Mosaic space at
// https://stand-in.example, built on the reference verifier, for tests only. It serves
//
//   GET  /.well-known/civic.json   a manifest shaped like a Civic Hub's, with an `actions` block
//   GET  /events                   an AS2 page whose activities carry `civic:actions`: a proposal
//                                  (comment, support), an event (rsvp), a poll (poll_answer), a
//                                  poll marked "passkey", a proposal whose support has closed, an
//                                  RSVP that can't be changed or withdrawn, and a changeable poll
//                                  with several choices
//   POST /actions                  the action endpoint: steps 1 to 9 by the reference verifier,
//                                  10 to 13 here
//
// with switches for `not_member`, `held` and `rate_limited`, and a record of every action it
// accepted (each with its JWS, as section 4 requires). It is a fetch-shaped handler
// (`handle(Request)`); tests reach it in-process. B3 mounts it behind the River's fetch guard
// through an injected dispatcher, switched on by the test-only TEST_STAND_IN_SPACE=1. Its DID
// resolver is handed in: the vectors' logs in unit tests, the local identity host's in API tests.
//
// Action ids are `https://stand-in.example/actions/{ref}`, so a test (and the vectors) can name
// the id a withdrawal will need before the space answers.
import {
  MemoryActionStores,
  answer,
  characterCount,
  handleAction,
  refusal,
  type Act,
  type DidDocumentResolver,
  type Outcome,
  type VerifiedAction,
  type Verb,
} from "../../../src/shared/spaceActions/index.js";

export const STAND_IN_HOST = "stand-in.example";
export const STAND_IN_ORIGIN = `https://${STAND_IN_HOST}`;
export const STAND_IN_AUDIENCE = `did:web:${STAND_IN_HOST}`;
export const STAND_IN_ENDPOINT = `${STAND_IN_ORIGIN}/actions`;
export const STAND_IN_JOIN = `${STAND_IN_ORIGIN}/join`;

/** One entry of `civic:actions` (2.2), as the stand-in advertises it. */
export interface StandInEntry {
  verb: Verb;
  target: string;
  closes_at?: string;
  max_length?: number;
  options?: Array<"yes" | "no" | "maybe">;
  choices?: Array<{ id: string; name: string }>;
  multiple?: boolean;
  changeable?: boolean;
  withdrawable?: boolean;
  assurance?: "passkey";
}

export interface StandInItem {
  activityId: string;
  type: string;
  objectId: string;
  objectType: string;
  name: string;
  published: string;
  actions: StandInEntry[];
}

export const STAND_IN_ITEMS: readonly StandInItem[] = Object.freeze([
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_1`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/proposals/prop_1`,
    objectType: "civic:Proposal",
    name: "Keep the skate park open until 9 in summer",
    published: "2026-10-20T12:00:00Z",
    actions: [
      { verb: "comment", target: `${STAND_IN_ORIGIN}/proposals/prop_1`, max_length: 500 },
      { verb: "support", target: `${STAND_IN_ORIGIN}/proposals/prop_1` },
    ],
  },
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_2`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/events/evt_1`,
    objectType: "Event",
    name: "Park clean-up, Saturday morning",
    published: "2026-10-21T12:00:00Z",
    actions: [{ verb: "rsvp", target: `${STAND_IN_ORIGIN}/events/evt_1`, options: ["yes", "no", "maybe"] }],
  },
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_3`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/polls/poll_1`,
    objectType: "Question",
    name: "Which day suits the clean-up?",
    published: "2026-10-22T12:00:00Z",
    actions: [
      {
        verb: "poll_answer",
        target: `${STAND_IN_ORIGIN}/polls/poll_1`,
        choices: [
          { id: "a", name: "Saturday" },
          { id: "b", name: "Sunday" },
          { id: "c", name: "Either" },
        ],
      },
    ],
  },
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_4`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/polls/poll_2`,
    objectType: "Question",
    name: "Should the budget go to the skate park? (confirmed with a passkey)",
    published: "2026-10-23T12:00:00Z",
    actions: [
      {
        verb: "poll_answer",
        target: `${STAND_IN_ORIGIN}/polls/poll_2`,
        choices: [
          { id: "yes", name: "Yes" },
          { id: "no", name: "No" },
        ],
        assurance: "passkey",
      },
    ],
  },
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_5`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/proposals/prop_2`,
    objectType: "civic:Proposal",
    name: "A bench by the pond (support closed)",
    published: "2026-09-20T12:00:00Z",
    actions: [{ verb: "support", target: `${STAND_IN_ORIGIN}/proposals/prop_2`, closes_at: "2026-10-01T00:00:00Z" }],
  },
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_6`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/events/evt_2`,
    objectType: "Event",
    name: "Council meeting (yes or no, final, can't be withdrawn)",
    published: "2026-10-24T12:00:00Z",
    actions: [
      { verb: "rsvp", target: `${STAND_IN_ORIGIN}/events/evt_2`, options: ["yes", "no"], changeable: false, withdrawable: false },
    ],
  },
  {
    activityId: `${STAND_IN_ORIGIN}/activities/act_7`,
    type: "Create",
    objectId: `${STAND_IN_ORIGIN}/polls/poll_3`,
    objectType: "Question",
    name: "Which events would you come to? (pick any, changeable)",
    published: "2026-10-25T12:00:00Z",
    actions: [
      {
        verb: "poll_answer",
        target: `${STAND_IN_ORIGIN}/polls/poll_3`,
        choices: [
          { id: "picnic", name: "Picnic" },
          { id: "quiz", name: "Quiz night" },
          { id: "walk", name: "Guided walk" },
        ],
        multiple: true,
        changeable: true,
      },
    ],
  },
].map((item) => Object.freeze({ ...item, actions: Object.freeze(item.actions.map((a) => Object.freeze(a))) as StandInEntry[] })));

/** An action the stand-in accepted or held. */
export interface StandInAction {
  id: string;
  did: string;
  act: Act;
  /** The JWS, kept as section 4 requires. */
  jws: string;
  status: "accepted" | "held";
  withdrawn: boolean;
  /** A later answer to the same RSVP or changeable poll replaced this one. */
  replaced: boolean;
}

export interface StandInOptions {
  resolver: DidDocumentResolver;
  /** Seconds since the epoch. */
  now: () => number;
  /** The DID hosts the manifest lists; default `id.test.example` (the vectors'). */
  didHosts?: string[];
}

export class StandInSpace {
  /** Switches for the answers a test wants (checks 12 and 14). */
  readonly switches = { notMember: false, held: false, rateLimited: false };
  /** DIDs and clients the space has blocked. */
  readonly blocked = new Set<string>();
  /** Every accepted or held action, by id. */
  readonly actions = new Map<string, StandInAction>();
  /** Every POST /actions it answered, in order: what tests count. */
  readonly posts: Array<{ status: number; code?: string }> = [];
  readonly stores = new MemoryActionStores();
  private readonly didHosts: string[];

  constructor(private readonly options: StandInOptions) {
    this.didHosts = options.didHosts ?? ["id.test.example"];
  }

  manifest(): Record<string, unknown> {
    return {
      name: "Stand-in Space (tests only)",
      space: { id: STAND_IN_AUDIENCE, scope: "community", type: "civic.hub" },
      feeds: [`${STAND_IN_ORIGIN}/events`],
      actions: {
        protocol: "mosaic-space-actions/0.1",
        endpoint: STAND_IN_ENDPOINT,
        audience: STAND_IN_AUDIENCE,
        did_hosts: this.didHosts,
        verbs: ["comment", "support", "rsvp", "poll_answer"],
        join: STAND_IN_JOIN,
        terms: `${STAND_IN_ORIGIN}/terms`,
      },
    };
  }

  feed(): Record<string, unknown> {
    const context = ["https://www.w3.org/ns/activitystreams", "https://civic.social/ns/civic"];
    return {
      "@context": context,
      id: `${STAND_IN_ORIGIN}/events?page=true`,
      type: "OrderedCollectionPage",
      partOf: `${STAND_IN_ORIGIN}/events`,
      orderedItems: [...STAND_IN_ITEMS].reverse().map((item) => ({
        "@context": context,
        id: item.activityId,
        type: item.type,
        actor: STAND_IN_AUDIENCE,
        published: item.published,
        to: ["https://www.w3.org/ns/activitystreams#Public"],
        generator: { id: STAND_IN_AUDIENCE, type: ["Organization", "civic:Hub"], name: "Stand-in Space", url: STAND_IN_ORIGIN },
        object: { id: item.objectId, type: item.objectType, name: item.name, url: item.objectId },
        url: item.objectId,
        "civic:actions": item.actions,
      })),
    };
  }

  /** The fetch-shaped handler. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.host !== STAND_IN_HOST) return new Response("", { status: 404 });
    if (url.pathname === "/.well-known/civic.json" && request.method === "GET") return json(200, this.manifest());
    if (url.pathname === "/events" && request.method === "GET") return json(200, this.feed());
    if (url.pathname === "/actions") {
      if (request.method !== "POST") return new Response("", { status: 405, headers: { allow: "POST" } });
      const body = new Uint8Array(await request.arrayBuffer());
      const outcome = await this.receive(request.headers.get("content-type"), body);
      const headers: Record<string, string> = { "content-type": outcome.contentType };
      if (outcome.retryAfter !== undefined) headers["retry-after"] = String(outcome.retryAfter);
      return new Response(JSON.stringify(outcome.body), { status: outcome.status, headers });
    }
    return new Response("", { status: 404 });
  }

  /** POST /actions without HTTP: the verifier, then the stand-in's own rules. */
  async receive(contentType: string | null, body: string | Uint8Array): Promise<Outcome> {
    const outcome = await handleAction(
      { contentType, body },
      {
        manifest: { endpoint: STAND_IN_ENDPOINT, audience: STAND_IN_AUDIENCE, did_hosts: this.didHosts },
        resolver: this.options.resolver,
        stores: this.stores,
        now: this.options.now,
      },
      (action) => this.decide(action),
    );
    const code = (outcome.body as { code?: string }).code;
    this.posts.push(code === undefined ? { status: outcome.status } : { status: outcome.status, code });
    return outcome;
  }

  private entryFor(target: string, verb: Verb): StandInEntry | undefined {
    for (const item of STAND_IN_ITEMS) {
      const entry = item.actions.find((a) => a.target === target && a.verb === verb);
      if (entry) return entry;
    }
    return undefined;
  }

  private knownTarget(target: string): boolean {
    return STAND_IN_ITEMS.some((item) => item.objectId === target);
  }

  /** Steps 10 to 13 (section 4) and 6's limits and moderation, as the switches say. */
  private async decide(action: VerifiedAction): Promise<Outcome> {
    const { claims, jws } = action;
    const act = claims.act;
    const did = claims.iss;

    // 10. Blocks.
    if (this.blocked.has(did) || this.blocked.has(claims.client)) return refusal("blocked");

    // 11. The target, as it is now.
    let entry: StandInEntry | undefined;
    if (act.verb === "withdraw") {
      const earlier = this.actions.get(act.target);
      if (!earlier || earlier.did !== did || earlier.withdrawn || earlier.replaced) return refusal("unknown_target");
      if (earlier.act.verb !== act.withdraws) return refusal("not_accepted");
      const original = this.entryFor(earlier.act.target, act.withdraws);
      const withdrawable = original?.withdrawable ?? act.withdraws !== "poll_answer";
      if (!withdrawable) return refusal("not_withdrawable");
      entry = original;
    } else {
      if (!this.knownTarget(act.target)) return refusal("unknown_target");
      entry = this.entryFor(act.target, act.verb);
      if (!entry) return refusal("not_accepted");
      if (entry.closes_at !== undefined && Date.parse(entry.closes_at) / 1000 < this.options.now()) return refusal("closed");
      if (act.verb === "comment" && characterCount(act.content) > (entry.max_length ?? 2000)) {
        return refusal("too_long", { detail: `At most ${entry.max_length ?? 2000} characters.` });
      }
      if (act.verb === "rsvp" && !(entry.options ?? ["yes", "no", "maybe"]).includes(act.answer)) return refusal("not_accepted");
      if (act.verb === "poll_answer") {
        const ids = new Set((entry.choices ?? []).map((c) => c.id));
        if (!act.choices.every((c) => ids.has(c)) || (!entry.multiple && act.choices.length !== 1)) {
          return refusal("not_accepted");
        }
      }
    }
    // An earlier live answer to an RSVP or poll: replaced if `changeable` (default true for RSVPs,
    // false for polls), else this one isn't accepted (DECISIONS, B1.5).
    let previous: StandInAction | undefined;
    if (act.verb === "rsvp" || act.verb === "poll_answer") {
      previous = [...this.actions.values()].find(
        (a) => a.did === did && a.act.verb === act.verb && a.act.target === act.target && !a.withdrawn && !a.replaced,
      );
      if (previous && !(entry?.changeable ?? act.verb === "rsvp")) {
        return refusal("not_accepted", { detail: "An answer can't be changed here." });
      }
    }
    if (entry?.assurance === "passkey" && claims.assurance !== "passkey") return refusal("assurance_required");

    // 12. Membership.
    if (this.switches.notMember) {
      return refusal("not_member", { join: STAND_IN_JOIN, detail: "Join the Stand-in Space to take part." });
    }

    // 13. Limits and moderation, then the record.
    if (this.switches.rateLimited) return refusal("rate_limited", { retryAfter: 60 });
    if (act.verb === "withdraw") {
      const earlier = this.actions.get(act.target)!;
      earlier.withdrawn = true;
      return answer({ status: "accepted", id: earlier.id, withdrawable: false, ref: act.ref });
    }
    const status = this.switches.held ? "held" : "accepted";
    const id = `${STAND_IN_ORIGIN}/actions/${act.ref}`;
    if (previous) previous.replaced = true;
    this.actions.set(id, { id, did, act, jws, status, withdrawn: false, replaced: false });
    const withdrawable = entry?.withdrawable ?? act.verb !== "poll_answer";
    return answer({
      status,
      id,
      url: act.verb === "comment" ? `${act.target}#${act.ref}` : act.target,
      withdrawable,
      ref: act.ref,
      ...(status === "held" ? { message: "A moderator will look at this soon." } : {}),
    });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
