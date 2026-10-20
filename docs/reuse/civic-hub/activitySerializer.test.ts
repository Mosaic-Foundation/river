/**
 * Activity serializer — golden, totality and determinism tests.
 *
 * These run without a database: the serializer is a pure projection of an
 * in-memory CivicEvent onto its AS2 wire form (Civic Activity Spec v0.2).
 *
 * The golden documents below are the contract. If a change to the serializer
 * changes one of them, that is a WIRE CHANGE — external consumers see it — so
 * the golden must be updated deliberately, with the spec open, never to make
 * a red test green.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CivicEvent } from "../../src/models/event.js";
import {
  toActivity,
  validateForEmission,
  mappedEventTypes,
  activityTypeIndex,
  EXTENSION_TERMS,
  UnmappedEventTypeError,
} from "../../src/events/activitySerializer.js";

// --- Deterministic environment ---------------------------------------------
// Every serialized property that comes from configuration is pinned here, so
// the goldens describe the serializer rather than the developer's .env.

const ENV = {
  BASE_URL: "https://hub.floyd.example",
  CIVIC_UI_BASE_URL: "https://app.floyd.example",
  CIVIC_SPACE_DID: "did:web:hub.floyd.example",
  HUB_NAME: "Floyd Civic Hub",
  CIVIC_JURISDICTION: "us-va-floyd",
  CIVIC_JURISDICTION_NAME: "Floyd County, Virginia",
};
const SAVED: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [key, value] of Object.entries(ENV)) {
    SAVED[key] = process.env[key];
    process.env[key] = value;
  }
});

afterAll(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// --- Fixtures ---------------------------------------------------------------

const GENERATOR = {
  id: "did:web:hub.floyd.example",
  type: ["Organization", "civic:Hub"],
  name: "Floyd Civic Hub",
  url: "https://hub.floyd.example",
};
const PLACE = {
  type: "Place",
  name: "Floyd County, Virginia",
  "civic:code": "us-va-floyd",
};
const AS2 = "https://www.w3.org/ns/activitystreams";
const CIVIC = "https://civic.social/ns/civic";
const HUB_NS = { hub: "https://hub.floyd.example/ns#" };
const PUBLIC = ["https://www.w3.org/ns/activitystreams#Public"];
const ADMINS = ["https://hub.floyd.example/audiences/admins"];
const PROCESS_IRI = "https://app.floyd.example/process/proc_abc";

function event(overrides: Partial<CivicEvent> = {}): CivicEvent {
  return {
    id: "evt_0001",
    version: "1.0",
    event_type: "civic.process.created",
    timestamp: "2026-07-21T10:12:33-04:00",
    process_id: "proc_abc",
    actor: "user:9f2c1b7a",
    jurisdiction: "us-va-floyd",
    action_url: "https://app.floyd.example/process/proc_abc",
    source: { hub_id: "civic-hub-floyd", hub_url: "https://hub.floyd.example" },
    data: {},
    meta: { visibility: "public" },
    ...overrides,
  };
}

// --- Golden documents -------------------------------------------------------

describe("toActivity — golden documents", () => {
  it("process created → Create + civic:Process", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.created",
        data: { process: { type: "civic.vote", title: "Green Box Sites" } },
      }),
    );

    expect(activity).toEqual({
      "@context": [AS2, CIVIC, HUB_NS],
      id: "https://hub.floyd.example/activities/evt_0001",
      type: "Create",
      actor: "https://app.floyd.example/users/9f2c1b7a",
      published: "2026-07-21T10:12:33-04:00",
      to: PUBLIC,
      generator: GENERATOR,
      location: PLACE,
      context: {
        id: PROCESS_IRI,
        type: "civic:Process",
        "civic:processType": "civic.vote",
      },
      object: {
        type: "civic:Process",
        id: PROCESS_IRI,
        name: "Green Box Sites",
        "hub:payload": { process: { type: "civic.vote", title: "Green Box Sites" } },
      },
      url: "https://app.floyd.example/process/proc_abc",
    });
  });

  it("process updated → Update + civic:Process", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.updated",
        data: {
          process: { type: "civic.vote", previous_status: "active", status: "closed" },
        },
      }),
    );
    expect(activity.type).toBe("Update");
    expect(activity.object).toEqual({
      type: "civic:Process",
      id: PROCESS_IRI,
      "hub:payload": {
        process: { type: "civic.vote", previous_status: "active", status: "closed" },
      },
    });
  });

  it("process started → civic:Start (no AS2 verb fits a lifecycle transition)", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.started",
        data: { process: { type: "civic.vote", method: "yes_no_unsure" } },
      }),
    );
    expect(activity.type).toBe("civic:Start");
    expect(activity.context).toEqual({
      id: PROCESS_IRI,
      type: "civic:Process",
      "civic:processType": "civic.vote",
    });
  });

  it("process ended → civic:End carrying civic:terminalState", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.ended",
        data: { result: { tally: { yes: 12, no: 3 }, total_votes: 15 } },
      }),
    );
    expect(activity.type).toBe("civic:End");
    expect(activity.object).toEqual({
      type: "civic:Process",
      id: PROCESS_IRI,
      "civic:terminalState": "closed",
      "hub:payload": { result: { tally: { yes: 12, no: 3 }, total_votes: 15 } },
    });
  });

  it("result published → Announce + civic:Result", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.result_published",
        data: {
          process: { type: "civic.brief" },
          brief: { title: "Green Box Sites — Results", headline: "Residents back three sites" },
        },
      }),
    );
    expect(activity.type).toBe("Announce");
    expect(activity.object).toMatchObject({
      type: "civic:Result",
      name: "Green Box Sites — Results",
    });
  });

  it("ballot cast → Create + civic:Ballot, and the selection is NEVER added", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.vote_submitted",
        actor: "did:web:id.civic.example:u:9f2c1b7a",
        meta: { visibility: "restricted" },
        data: { process: { type: "civic.vote" }, vote: { changed: false } },
      }),
    );

    expect(activity).toEqual({
      "@context": [AS2, CIVIC, HUB_NS],
      id: "https://hub.floyd.example/activities/evt_0001",
      type: "Create",
      // A DID actor passes through untouched.
      actor: "did:web:id.civic.example:u:9f2c1b7a",
      published: "2026-07-21T10:12:33-04:00",
      // Restricted addressing — no as:Public anywhere.
      to: ADMINS,
      generator: GENERATOR,
      location: PLACE,
      context: {
        id: PROCESS_IRI,
        type: "civic:Process",
        "civic:processType": "civic.vote",
      },
      object: {
        type: "civic:Ballot",
        "hub:payload": { process: { type: "civic.vote" }, vote: { changed: false } },
      },
      url: "https://app.floyd.example/process/proc_abc",
    });

    // Spec §5.4, the case implementers get wrong: nothing in the document
    // says how this participant voted.
    const json = JSON.stringify(activity);
    expect(json).not.toContain("selection");
    expect(json).not.toContain("choice");
    expect(activity.to).not.toContain("https://www.w3.org/ns/activitystreams#Public");
  });

  it("ballot cast → civic:method is carried only when the payload has one", () => {
    const withMethod = toActivity(
      event({
        event_type: "civic.process.vote_submitted",
        data: { vote: { method: "approval", changed: false } },
      }),
    );
    expect(withMethod.object).toMatchObject({
      type: "civic:Ballot",
      "civic:method": "approval",
    });

    const withoutMethod = toActivity(
      event({ event_type: "civic.process.vote_submitted", data: {} }),
    );
    expect(withoutMethod.object).toEqual({ type: "civic:Ballot" });
  });

  it("comment added → Create + Note with content and inReplyTo", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.comment_added",
        actor: "anonymous",
        data: {
          comment: {
            id: "cmt_1",
            body_preview: "The proposed route would cut off Alum Ridge Road.",
            is_anonymous: true,
          },
        },
      }),
    );
    expect(activity.type).toBe("Create");
    expect(activity.object).toEqual({
      type: "Note",
      content: "The proposed route would cut off Alum Ridge Road.",
      inReplyTo: PROCESS_IRI,
      "hub:payload": {
        comment: {
          id: "cmt_1",
          body_preview: "The proposed route would cut off Alum Ridge Road.",
          is_anonymous: true,
        },
      },
    });
  });

  it("proposal submitted → Create + civic:Proposal; supported → Like", () => {
    const submitted = toActivity(
      event({
        event_type: "civic.proposal.submitted",
        data: { process: { type: "civic.proposal" }, proposal: { title: "Sidewalk on Locust" } },
      }),
    );
    expect(submitted.type).toBe("Create");
    expect(submitted.object).toMatchObject({
      type: "civic:Proposal",
      id: PROCESS_IRI,
      name: "Sidewalk on Locust",
    });

    const supported = toActivity(
      event({
        event_type: "civic.proposal.supported",
        data: { proposal: { support_count: 4, support_threshold: 10 } },
      }),
    );
    // AS2 already has a verb for endorsement — no civic term needed.
    expect(supported.type).toBe("Like");
    expect(supported.object).toMatchObject({ type: "civic:Proposal" });
  });

  it("outcome recorded → Create + civic:Outcome; delivered → Announce + target", () => {
    const recorded = toActivity(
      event({
        event_type: "civic.process.outcome_recorded",
        data: { source_process_id: "proc_src", delivered_to_count: 5 },
      }),
    );
    expect(recorded.type).toBe("Create");
    expect(recorded.object).toMatchObject({ type: "civic:Outcome" });
    expect(recorded.target).toBeUndefined();

    const delivered = toActivity(
      event({
        event_type: "civic.outcome_delivered",
        data: {
          originating_process_id: "proc_src",
          delivered_to: "https://rep.floyd.example/spaces/board",
        },
      }),
    );
    expect(delivered.type).toBe("Announce");
    expect(delivered.object).toMatchObject({ type: "civic:Outcome" });
    expect(delivered.target).toBe("https://rep.floyd.example/spaces/board");
  });

  it("hub-local family → nearest AS2 verb + a hub-namespaced object", () => {
    const activity = toActivity(
      event({
        event_type: "civic.process.proposed",
        data: {
          process: { type: "civic.vote", method: "yes_no_unsure", support_threshold: 10 },
        },
      }),
    );
    expect(activity.type).toBe("Offer");
    expect(activity.object).toMatchObject({ type: "hub:ProposedProcess" });
    // The hub namespace is declared on the documents that use it.
    expect(activity["@context"]).toEqual([AS2, CIVIC, HUB_NS]);
  });

  it("system actors become component-named space IRIs", () => {
    const activity = toActivity(
      event({ event_type: "civic.process.ended", actor: "system:auto-close" }),
    );
    // Never a generic "system" — audit logs must tell components apart.
    expect(activity.actor).toBe("https://hub.floyd.example/system/auto-close");
  });

  it("omits location entirely where there is no civic geography", () => {
    for (const jurisdiction of ["", "local", "none", "LOCAL"]) {
      const activity = toActivity(event({ jurisdiction }));
      expect(activity).not.toHaveProperty("location");
      expect(JSON.stringify(activity)).not.toContain('"none"');
    }
  });

  it("labels a Place only with its own deployment's name", () => {
    const elsewhere = toActivity(event({ jurisdiction: "us-va-roanoke" }));
    expect(elsewhere.location).toEqual({ type: "Place", "civic:code": "us-va-roanoke" });
  });

  it("omits context for events that belong to no process", () => {
    const activity = toActivity(event({ process_id: "" }));
    expect(activity).not.toHaveProperty("context");
    expect(activity.object).toEqual({ type: "civic:Process" });
  });

  it("normalizes a timestamp with no offset, and rejects an unparseable one", () => {
    expect(toActivity(event({ timestamp: "2026-07-21T14:12:33" })).published).toBe(
      new Date("2026-07-21T14:12:33").toISOString(),
    );
    // Postgres' own form is passed through verbatim.
    expect(
      toActivity(event({ timestamp: "2026-08-14T15:27:31.245895+00:00" })).published,
    ).toBe("2026-08-14T15:27:31.245895+00:00");
    expect(() => toActivity(event({ timestamp: "not-a-date" }))).toThrow(
      /not a valid date/,
    );
  });

  it("every golden document carries the spec's MUST-level properties", () => {
    const samples = mappedEventTypes().map((event_type) =>
      toActivity(event({ event_type, data: { process: { type: "civic.vote" } } })),
    );
    for (const activity of samples) {
      expect(activity["@context"]).toBeDefined();
      expect(String(activity.id)).toMatch(/^https?:\/\//);
      expect(typeof activity.type).toBe("string");
      expect(String(activity.actor)).toMatch(/^(https?:\/\/|did:)/);
      expect(String(activity.published)).toMatch(/(Z|[+-]\d{2}:\d{2})$/);
      expect(Array.isArray(activity.to)).toBe(true);
      expect((activity.to as string[]).length).toBeGreaterThan(0);
      expect(activity.generator).toMatchObject({ id: expect.any(String) });
      expect(activity.object).toBeDefined();
      // Process linkage is required for process activities (§4).
      expect(activity.context).toMatchObject({ id: PROCESS_IRI, type: "civic:Process" });
    }
  });
});

// --- Determinism -------------------------------------------------------------

describe("toActivity — determinism", () => {
  it("serializes the same event to a byte-identical document", () => {
    const source = event({
      event_type: "civic.process.result_published",
      data: {
        process: { type: "civic.vote" },
        result: { tally: { yes: 2, no: 1 }, total_votes: 3, computed_at: "2026-07-21T10:00:00Z" },
      },
    });
    const first = toActivity(source);
    const second = toActivity(source);
    expect(second).toEqual(first);
    // Byte-identical, not merely deep-equal: future work signs these bytes.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

// --- Totality over every emitted event type ---------------------------------

/**
 * Event types no code path emits any more, but which remain in the append-only
 * log and must therefore stay serializable forever. Removing one from the
 * mapping table would break `GET /events` for the history that carries it.
 */
const RETIRED_TYPES = new Set([
  // Deliberation close used to auto-deliver its outcome; the universal
  // civic.brief review seam replaced that. Pre-change conversations still
  // carry the event.
  "civic.outcome_delivered",
]);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Re-enumerate every `event_type: "…"` literal in the backend. This is the
 * guard that keeps the mapping table total: add an emitter without adding a
 * mapping and this test fails, rather than the omission surfacing as a 500 on
 * the public feed (or, worse, as a silently generic activity).
 */
function emittedEventTypes(): Set<string> {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
  const found = new Set<string>();
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/event_type:\s*"([^"]+)"/g)) {
      found.add(match[1]);
    }
    // Comparisons like `e.event_type === "civic.x"` are reads, not emissions,
    // and are deliberately not collected.
  }
  return found;
}

describe("mapping table totality", () => {
  it("maps every event_type emitted anywhere in src/", () => {
    const emitted = [...emittedEventTypes()].sort();
    const mapped = new Set(mappedEventTypes());
    const missing = emitted.filter((t) => !mapped.has(t));
    expect(missing, `unmapped event types: ${missing.join(", ")}`).toEqual([]);
    // Sanity: the enumeration itself must be finding things.
    expect(emitted.length).toBeGreaterThan(15);
  });

  it("carries no mapping that is neither emitted nor a retired stored type", () => {
    const emitted = emittedEventTypes();
    const stale = mappedEventTypes().filter(
      (t) => !emitted.has(t) && !RETIRED_TYPES.has(t),
    );
    expect(stale, `mappings with no emitter: ${stale.join(", ")}`).toEqual([]);
  });

  it("throws loudly, not silently, on an unmapped type", () => {
    expect(() => toActivity(event({ event_type: "civic.process.invented" }))).toThrow(
      UnmappedEventTypeError,
    );
    expect(() => toActivity(event({ event_type: "civic.process.invented" }))).toThrow(
      /no activity mapping/,
    );
  });

  it("registers every hub extension term it can actually emit", () => {
    // EXTENSION_TERMS is the register HANDOFF.md publishes as the list of
    // promotion candidates. Emit one document per mapped type and check that
    // no `hub:` term escapes unregistered.
    const registered = new Set(EXTENSION_TERMS.map((t) => t.term));
    const emitted = new Set<string>();
    for (const event_type of mappedEventTypes()) {
      const activity = toActivity(
        event({ event_type, data: { process: { type: "civic.vote" } } }),
      );
      for (const term of JSON.stringify(activity).matchAll(/"(hub:[A-Za-z]+)"/g)) {
        emitted.add(term[1]);
      }
    }
    const unregistered = [...emitted].filter((t) => !registered.has(t)).sort();
    expect(unregistered, `unregistered hub terms: ${unregistered.join(", ")}`).toEqual(
      [],
    );
    // And the register carries nothing invented: hub:payload only shows up
    // when a payload exists, so check the rest are all reachable.
    expect(emitted.size).toBeGreaterThan(3);
  });

  it("indexes activity types back to the event types that produce them", () => {
    const index = activityTypeIndex();
    expect(index.Create).toContain("civic.process.created");
    expect(index["civic:End"]).toContain("civic.process.ended");
    // Every mapped event type appears exactly once in the inverse index.
    const flattened = Object.values(index).flat().sort();
    expect(flattened).toEqual(mappedEventTypes());
  });
});

// --- Emission-path validation ------------------------------------------------

describe("validateForEmission", () => {
  it("rejects an event with no actor (AS2 requires one)", () => {
    expect(() => validateForEmission(event({ actor: "" }))).toThrow(/no actor/);
  });

  it("rejects an unmapped type before anything can be stored", () => {
    expect(() =>
      validateForEmission(event({ event_type: "civic.process.invented" })),
    ).toThrow(UnmappedEventTypeError);
  });

  it("accepts a well-formed event and returns its wire form", () => {
    const document = validateForEmission(event());
    expect(document.type).toBe("Create");
  });
});

describe("ballot secrecy is structural, not conventional", () => {
  // The guard exists because `hub:payload` carries the event's data verbatim:
  // without it, "no emitter ever puts a choice in a ballot payload" would be a
  // convention, and one careless change would publish votes on a permanent
  // public wire. See Civic Activity Spec §5.4.

  const withSelection = (data: Record<string, unknown>) =>
    event({ event_type: "civic.process.vote_submitted", data });

  it("refuses to STORE a ballot whose payload names a choice", () => {
    // Refusing at emission protects more than the wire: the event log is
    // append-only, so storing the choice next to the actor would link voter to
    // ballot permanently.
    expect(() =>
      validateForEmission(withSelection({ vote: { changed: false, selection: "yes" } })),
    ).toThrow(/MUST NOT record the participant's choice/);
  });

  it("catches a choice at any depth and under any of its spellings", () => {
    for (const data of [
      { vote: { option_id: "opt_1" } },
      { vote: { choice: "no" } },
      { ballot: { ranked_choices: ["a", "b"] } },
      { vote: { detail: { nested: { selections: ["x"] } } } },
      { approvals: ["a"] },
    ]) {
      expect(
        () => validateForEmission(withSelection(data)),
        `expected a selection to be caught in ${JSON.stringify(data)}`,
      ).toThrow(/MUST NOT record the participant's choice/);
    }
  });

  it("leaves the hub's real ballot payload alone", () => {
    // `vote` is a container, not a disclosure — vote: { changed } must pass.
    expect(() =>
      validateForEmission(withSelection({ vote: { changed: false } })),
    ).not.toThrow();
    // …as must a non-ballot activity that legitimately lists the options on
    // offer: the question is public, only the answer is secret.
    expect(() =>
      validateForEmission(
        event({
          event_type: "civic.process.started",
          data: { process: { type: "civic.vote", options: ["Yes", "No"] } },
        }),
      ),
    ).not.toThrow();
  });

  it("strips a choice from a STORED row rather than breaking the feed", () => {
    // A single bad row must not 500 /events for everyone, so the read path
    // strips instead of throwing — stored history can never leak a choice.
    const activity = toActivity(
      withSelection({ vote: { changed: false, selection: "yes" } }),
    );
    const json = JSON.stringify(activity);
    expect(json).not.toContain("selection");
    expect(json).not.toContain("yes");
    expect(activity.object).toEqual({
      type: "civic:Ballot",
      "hub:payload": { vote: { changed: false } },
    });
  });
});

describe("emitEvent — an event that cannot be serialized is never stored", () => {
  it("rejects an unmapped event type before touching the store", async () => {
    // No SUPABASE_* env is needed: emitEvent validates before appendEvent, so
    // if this ever reaches the database the test fails on a different error —
    // which is itself the signal that the guard moved or was removed.
    const { emitEvent } = await import("../../src/events/eventEmitter.js");

    await expect(
      emitEvent({
        event_type: "civic.process.definitely_not_mapped",
        actor: "user:9f2c1b7a",
        process_id: "proc_abc",
        jurisdiction: "us-va-floyd",
        data: {},
      }),
    ).rejects.toThrow(/refusing to store an event that cannot be serialized/);
  });

  it("rejects an event with no actor", async () => {
    const { emitEvent } = await import("../../src/events/eventEmitter.js");

    await expect(
      emitEvent({
        event_type: "civic.process.created",
        actor: "",
        process_id: "proc_abc",
        jurisdiction: "us-va-floyd",
        data: {},
      }),
    ).rejects.toThrow(/no actor/);
  });
});
