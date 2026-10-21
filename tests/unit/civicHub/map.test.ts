// Stream keys from hub UI URLs (spec 4.2 Streams) and the activity-to-item mapping (spec 4.2 Map,
// Public-only, check 22's adapter half). Recorded activities unless marked DERIVED.
import { describe, expect, it } from "vitest";
import {
  AS_PUBLIC,
  isPublic,
  mapActivity,
  processIdFromPath,
  streamKeyFromUrl,
} from "../../../src/river/adapters/civicHub/index.js";
import { LINK_REL } from "../../../src/shared/sanitize/index.js";
import { recordedActivity } from "./helpers.js";

describe("stream keys", () => {
  it("maps each hub UI path to https://{host}/process/{id}", () => {
    for (const path of ["process", "meeting-summary", "project", "brief", "announcement"]) {
      expect(streamKeyFromUrl(new URL(`https://Longmont.civic.social/${path}/proc_4ebb11759c4c40ce`))).toBe(
        "https://longmont.civic.social/process/proc_4ebb11759c4c40ce",
      );
    }
    expect(streamKeyFromUrl(new URL("https://floyd.civic.social/process/proc_beta_vote_energy_001?tab=results"))).toBe(
      "https://floyd.civic.social/process/proc_beta_vote_energy_001",
    );
  });

  it("finds no stream in other paths or ids", () => {
    for (const path of ["/", "/events", "/process/", "/process/abc", "/users/proc_1", "/process/proc_1;drop", "/proposal/proc_1"]) {
      expect(processIdFromPath(path), path).toBeUndefined();
    }
  });
});

describe("mapping", () => {
  it("maps id, published, url, context, name, place code and labels (recorded Floyd vote start)", () => {
    const start = recordedActivity("civic:Start", "civic:Process", "civic.vote")!;
    const { item } = mapActivity(start)!;
    expect(item.sourceId).toBe(start.id);
    expect(item.publishedAt.toISOString()).toBe(new Date(start.published as string).toISOString());
    expect(item.url).toBe(start.url);
    expect(item.streamKey).toBe(start.context!.id);
    expect(item.kind).toBe("civic");
    expect(item.media).toEqual([]);
    expect(item.raw).toBe(start);
    expect(item.civic).toMatchObject({
      activityType: "civic:Start",
      objectType: "civic:Process",
      processType: "civic.vote",
      processIri: start.context!.id,
      placeCode: (start.location as Record<string, string>)["civic:code"],
      label: "A process started",
    });
  });

  it("reads hub:payload voting_closes_at into civic.deadline (hubs nest it under process)", () => {
    const start = recordedActivity("civic:Start", "civic:Process", "civic.vote")!;
    const payload = start.object["hub:payload"] as { process: { voting_closes_at: string } };
    expect(mapActivity(start)!.item.civic?.deadline).toBe(new Date(payload.process.voting_closes_at).toISOString());
    // DERIVED: the spec's top-level spelling works too.
    const flat = { ...start, object: { ...start.object, "hub:payload": { voting_closes_at: "2026-11-03T19:00:00Z" } } };
    expect(mapActivity(flat)!.item.civic?.deadline).toBe("2026-11-03T19:00:00.000Z");
  });

  it("titles from object.name, else the stream's title, and records the stream title from Create civic:Process", () => {
    const create = recordedActivity("Create", "civic:Process", "civic.vote")!;
    const mapped = mapActivity(create)!;
    expect(mapped.item.title).toBe(create.object.name);
    expect(mapped.streamTitle).toBe(create.object.name);

    const end = recordedActivity("civic:End", "civic:Process", "civic.vote")!;
    expect(mapActivity(end)!.item.title).toBeUndefined();
    const key = end.context!.id as string;
    expect(mapActivity(end, new Map([[key, "Energy vote"]]))!.item.title).toBe("Energy vote");
  });

  it("carries civic:terminalState", () => {
    const end = recordedActivity("civic:End", "civic:Process", "civic.vote")!;
    expect(mapActivity(end)!.item.civic?.terminalState).toBe("closed");
  });

  it("skips anything not addressed to as:Public (DERIVED from a recorded activity)", () => {
    const create = recordedActivity("Create", "civic:Process")!;
    expect(isPublic(create)).toBe(true);
    for (const to of [["https://floyd.civic.social/audiences/admins"], [], undefined, "https://www.w3.org/ns/activitystreams#Publicx"]) {
      expect(mapActivity({ ...create, to })).toBeUndefined();
    }
    expect(mapActivity({ ...create, to: [], cc: [AS_PUBLIC] })).toBeDefined();
    expect(mapActivity({ ...create, to: "as:Public" })).toBeDefined();
  });

  it("skips activities without an https id or a valid date", () => {
    const create = recordedActivity("Create", "civic:Process")!;
    expect(mapActivity({ ...create, id: "javascript:alert(1)" })).toBeUndefined();
    expect(mapActivity({ ...create, published: "not a date" })).toBeUndefined();
    expect(mapActivity(null)).toBeUndefined();
    expect(mapActivity("Create")).toBeUndefined();
  });

  it("keeps only https item URLs and stream keys", () => {
    const create = recordedActivity("Create", "civic:Process")!;
    const mapped = mapActivity({ ...create, url: "javascript:alert(1)", context: { id: "http://x.example/process/proc_1" } })!;
    expect(mapped.item.url).toBeUndefined();
    expect(mapped.item.streamKey).toBeUndefined();
  });

  it("check 22 (adapter half): content goes through the sanitizer, titles and summaries are plain text (DERIVED)", () => {
    const note = recordedActivity("Create", "Note")!;
    const derived = {
      ...note,
      object: {
        ...note.object,
        name: "<b>Budget</b> <script>alert(1)</script>hearing",
        summary: '<img src=x onerror="alert(2)">Short <em>summary</em>',
        content:
          '<p>Hi<script>alert(3)</script><img src="x" onerror="alert(4)"><a href="javascript:alert(5)">x</a> ' +
          '<a href="https://floyd.civic.social/"><span class="invisible">https://</span><span class="ellipsis">floyd.civic.social</span></a></p>',
      },
    };
    const { item } = mapActivity(derived)!;
    expect(item.title).toBe("Budget hearing");
    expect(item.summary).toBe("Short summary");
    expect(item.contentHtml).not.toMatch(/script|alert|onerror|javascript:|<img/i);
    expect(item.contentHtml).toContain('<span class="invisible">https://</span>');
    expect(item.contentHtml).toContain('<span class="ellipsis">floyd.civic.social</span>');
    expect(item.contentHtml).toContain(`<a href="https://floyd.civic.social/" rel="${LINK_REL}">`);
  });
});
