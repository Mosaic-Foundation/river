// The hub allowlist (spec 4.2 "Which hub activities show", ADR-003): one test per row of the
// spec's table, the hidden list, and closed-by-default. Rows are proved on recorded activities
// where the seed hubs have one; the few shapes they haven't sent are DERIVED from a recorded
// activity of the same family (type and ids edited) and say so.
import { describe, expect, it } from "vitest";
import { ALLOWLIST, KNOWN_HIDDEN, allowRow, mapActivity } from "../../../src/river/adapters/civicHub/index.js";
import { recordedActivity, type Activity } from "./helpers.js";

/** A recorded activity of this shape, or one DERIVED from a recorded relative when none exists. */
function sample(type: string, objectType: string, processType?: string): { activity: Activity; derived: boolean } {
  const real = recordedActivity(type, objectType, processType);
  if (real) return { activity: real, derived: false };
  const base = recordedActivity("civic:End", "civic:Process", "civic.proposal")!;
  return {
    derived: true,
    activity: {
      ...base,
      id: `${base.id}-derived-${type}-${objectType}`.replace(/[^a-zA-Z0-9:/._-]/g, "-"),
      type,
      context: { ...(base.context ?? {}), ...(processType ? { "civic:processType": processType } : {}) },
      object: { ...base.object, type: objectType },
    },
  };
}

function shows(type: string, objectType: string, processType: string | undefined, label: string, kind = "civic") {
  const { activity } = sample(type, objectType, processType);
  const mapped = mapActivity(activity);
  expect(mapped, `${type} ${objectType}`).toBeDefined();
  expect(mapped!.item.hidden).toBe(false);
  expect(mapped!.item.civic?.label).toBe(label);
  expect(mapped!.item.kind).toBe(kind);
  return mapped!;
}

describe("hub allowlist: one test per row of spec 4.2's table", () => {
  it("Create civic:Process: a process opened (kind civic)", () => {
    shows("Create", "civic:Process", "civic.vote", "A process opened");
  });
  it("civic:Start civic:Process: a process started", () => {
    shows("civic:Start", "civic:Process", "civic.vote", "A process started");
  });
  it("civic:End civic:Process: a process ended, and it ends the stream", () => {
    expect(shows("civic:End", "civic:Process", "civic.vote", "A process ended").endsStream).toBe(true);
  });
  it("civic:End civic:Proposal: a proposal closed (hubs send it as civic:Process with processType civic.proposal)", () => {
    expect(shows("civic:End", "civic:Process", "civic.proposal", "A proposal closed").endsStream).toBe(true);
    expect(shows("civic:End", "civic:Proposal", "civic.proposal", "A proposal closed").endsStream).toBe(true); // derived
  });
  it("civic:End hub:Project: a project archived (derived: the seed hubs have archived none)", () => {
    expect(shows("civic:End", "hub:Project", "civic.project", "A project archived").endsStream).toBe(true);
    expect(shows("civic:End", "civic:Process", "civic.project", "A project archived").endsStream).toBe(true);
  });
  it("Announce civic:Result: results published, a final-result candidate", () => {
    expect(shows("Announce", "civic:Result", "civic.vote", "Results published").finalCandidate).toBe(true);
  });
  it("Announce civic:Outcome: an outcome delivered (derived)", () => {
    expect(shows("Announce", "civic:Outcome", "civic.polis_deliberation", "An outcome delivered").finalCandidate).toBe(false);
  });
  it("Announce hub:SupportThreshold: a proposal reached its support threshold (derived)", () => {
    shows("Announce", "hub:SupportThreshold", "civic.proposal", "A proposal reached its support threshold");
  });
  it("Create civic:Proposal: a proposal submitted", () => {
    shows("Create", "civic:Proposal", "civic.proposal", "A proposal submitted");
  });
  it("Create civic:Outcome: an outcome recorded, a final-result candidate", () => {
    expect(shows("Create", "civic:Outcome", "civic.brief", "An outcome recorded").finalCandidate).toBe(true);
  });
  it("Create hub:Aggregation: results summarized; meeting summaries are kind article", () => {
    shows("Create", "hub:Aggregation", "civic.vote", "Results summarized");
    shows("Create", "hub:Aggregation", "civic.brief", "Results summarized");
    shows("Create", "hub:Aggregation", "civic.meeting_summary", "Results summarized", "article");
  });
  it("Create hub:OfficialResponse: an official responded (the hub's unanchored repeats stay hidden)", () => {
    shows("Create", "hub:OfficialResponse", "civic.brief", "An official responded");
    // Derived: the recorded response with the hub's feed_anchor flag turned off.
    const real = recordedActivity("Create", "hub:OfficialResponse", "civic.brief")!;
    const payload = real.object["hub:payload"] as Record<string, unknown>;
    const repeat = { ...real, id: `${real.id}-derived-repeat`, object: { ...real.object, "hub:payload": { ...payload, feed_anchor: false } } };
    expect(mapActivity(repeat)!.item.hidden).toBe(true);
  });
  it("Create and Update hub:Project: a project created or updated", () => {
    shows("Create", "hub:Project", "civic.project", "A project created");
    shows("Update", "hub:Project", "civic.project", "A project updated");
  });
  it("Offer hub:ProposedProcess: a process proposed", () => {
    shows("Offer", "hub:ProposedProcess", "civic.vote", "A process proposed");
  });

  it("every row in the file is covered above (the table and the file agree)", () => {
    const keys = ALLOWLIST.map((r) => `${r.activity} ${r.object}${r.processType ? ` ${r.processType}` : ""}`).sort();
    expect(keys).toEqual(
      [
        "Create civic:Process",
        "civic:Start civic:Process",
        "civic:End civic:Process",
        "civic:End civic:Process civic.proposal",
        "civic:End civic:Process civic.project",
        "civic:End civic:Proposal",
        "civic:End hub:Project",
        "Announce civic:Result",
        "Announce civic:Outcome",
        "Announce hub:SupportThreshold",
        "Create civic:Proposal",
        "Create civic:Outcome",
        "Create hub:Aggregation",
        "Create hub:Aggregation civic.meeting_summary",
        "Create hub:OfficialResponse",
        "Create hub:Project",
        "Update hub:Project",
        "Offer hub:ProposedProcess",
      ].sort(),
    );
  });
});

describe("hub allowlist: hidden", () => {
  for (const shape of KNOWN_HIDDEN) {
    it(`${shape.activity} ${shape.object}${shape.processType ? ` (${shape.processType})` : ""} is stored hidden: ${shape.why}`, () => {
      expect(allowRow(shape.activity, shape.object, shape.processType)).toBeUndefined();
      const { activity, derived } = sample(shape.activity, shape.object, shape.processType);
      const mapped = mapActivity(activity);
      expect(mapped, derived ? "derived" : "recorded").toBeDefined();
      expect(mapped!.item.hidden).toBe(true);
      expect(mapped!.item.civic?.label).toBeUndefined();
      expect(mapped!.finalCandidate).toBe(false);
    });
  }

  it("is closed by default: an activity type no row names is stored hidden", () => {
    const { activity } = sample("civic:Invented", "hub:SomethingNew", "civic.vote");
    const mapped = mapActivity(activity)!;
    expect(mapped.item.hidden).toBe(true);
    expect(allowRow("Create", undefined)).toBeUndefined();
    expect(allowRow(undefined, "civic:Process")).toBeUndefined();
  });

  it("the recorded hidden shapes include ballots' kin: support signals, comments and process updates", () => {
    for (const [type, object] of [
      ["Like", "civic:Proposal"],
      ["Undo", "civic:Proposal"],
      ["Create", "Note"],
      ["Update", "civic:Process"],
      ["Update", "hub:ProjectSentiment"],
    ] as const) {
      const real = recordedActivity(type, object);
      expect(real, `${type} ${object} recorded`).toBeDefined();
      expect(mapActivity(real)!.item.hidden).toBe(true);
    }
  });
});
