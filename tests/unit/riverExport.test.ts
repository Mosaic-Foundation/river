// The member export's document (spec 3.3, check 29, logic part): the spec's keys and nothing else,
// follows with stream keys, rules and circle names, circles in order, preferences without the
// River's internal seed_pending, and pending seeds exported as the follows they will become.
import { describe, expect, it } from "vitest";
import { EXPORT_FORMAT, exportDocument, type ExportRows } from "../../src/river/export/index.js";

const AT = new Date("2026-10-21T12:00:00.000Z");
const DID = "did:webvh:QmScid:id.mosaic.social:u:abcd2345";
const HUB = "https://demosville.civic.social";
const W3C = "https://w3c.social/users/w3c";
const STREAM = "https://longmont.civic.social/process/proc_4ebb11759c4c40ce";

function rows(overrides: Partial<ExportRows> = {}): ExportRows {
  return {
    rules: [
      { space_id: "s-hub", url: HUB, stream_key: null, rule: "follow" },
      { space_id: "s-w3c", url: W3C, stream_key: null, rule: "follow" },
      { space_id: "s-longmont", url: "https://longmont.civic.social", stream_key: STREAM, rule: "mute" },
    ],
    circles: [
      { id: "c-civic", name: "Civic", color: "#2F6FA8", role: "civic" },
      { id: "c-news", name: "News and ideas", color: "#7A5AA6", role: null },
      { id: "c-family", name: "Family", color: null, role: null },
    ],
    members: [
      { circle_id: "c-news", space_id: "s-hub" },
      { circle_id: "c-civic", space_id: "s-hub" },
      { circle_id: "c-news", space_id: "s-w3c" },
      { circle_id: "c-civic", space_id: "s-longmont" },
    ],
    preferences: [],
    ...overrides,
  };
}

describe("exportDocument (spec 3.3)", () => {
  it("has exactly the spec's keys, format and version", () => {
    const doc = exportDocument(DID, rows(), AT);
    expect(Object.keys(doc).sort()).toEqual(["circles", "did", "exported_at", "follows", "format", "preferences", "version"]);
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.format).toBe("mosaic-river-export");
    expect(doc.version).toBe(1);
    expect(doc.exported_at).toBe("2026-10-21T12:00:00.000Z");
    expect(doc.did).toBe(DID);
    for (const f of doc.follows) expect(Object.keys(f).sort()).toEqual(["circles", "rule", "stream_key", "url"]);
    for (const c of doc.circles) expect(Object.keys(c).sort()).toEqual(["color", "name", "role"]);
  });

  it("lists every rule with its URL, stream key and rule, and circle names in circle order", () => {
    const doc = exportDocument(DID, rows(), AT);
    expect(doc.follows).toEqual([
      { url: HUB, stream_key: null, rule: "follow", circles: ["Civic", "News and ideas"] },
      { url: W3C, stream_key: null, rule: "follow", circles: ["News and ideas"] },
      { url: "https://longmont.civic.social", stream_key: STREAM, rule: "mute", circles: ["Civic"] },
    ]);
  });

  it("lists circles in the member's order with color and role, empty ones included", () => {
    expect(exportDocument(DID, rows(), AT).circles).toEqual([
      { name: "Civic", color: "#2F6FA8", role: "civic" },
      { name: "News and ideas", color: "#7A5AA6", role: null },
      { name: "Family", color: null, role: null },
    ]);
  });

  it("keeps preferences as an object of key to value, without seed_pending", () => {
    const doc = exportDocument(
      DID,
      rows({
        preferences: [
          { key: "seed_pending", value: [] },
          { key: "theme", value: "civic" },
          { key: "filters", value: { type: "podcast" } },
        ],
      }),
      AT,
    );
    expect(doc.preferences).toEqual({ theme: "civic", filters: { type: "podcast" } });
  });

  it("gives an empty object, not null, when there are no preferences", () => {
    expect(exportDocument(DID, rows(), AT).preferences).toEqual({});
  });

  it("exports seeds still waiting for their space as follows, with their circles' names", () => {
    const pending = [
      { url: "@eff@mastodon.social", follow: true, circleIds: ["c-news", "c-gone"] },
      { url: "https://floyd.civic.social", stream_key: "https://floyd.civic.social/process/p1", follow: true, circleIds: [] },
      { url: "@circle-only@example.social", follow: false, circleIds: ["c-family"] },
      { url: HUB, follow: true, circleIds: ["c-civic"] },
      { nonsense: true },
    ];
    const doc = exportDocument(DID, rows({ preferences: [{ key: "seed_pending", value: pending }] }), AT);
    expect(doc.follows.slice(3)).toEqual([
      { url: "@eff@mastodon.social", stream_key: null, rule: "follow", circles: ["News and ideas"] },
      { url: "https://floyd.civic.social", stream_key: "https://floyd.civic.social/process/p1", rule: "follow", circles: [] },
    ]);
    expect(doc.follows.filter((f) => f.url === HUB)).toHaveLength(1);
    expect(doc.preferences).toEqual({});
  });

  it("ignores a circle membership that names no circle of the member's", () => {
    const doc = exportDocument(DID, rows({ members: [{ circle_id: "c-other", space_id: "s-hub" }] }), AT);
    expect(doc.follows[0]?.circles).toEqual([]);
  });

  it("carries a null DID when the account has none on record", () => {
    expect(exportDocument(null, rows(), AT).did).toBeNull();
  });

  it("serializes to JSON with nothing that looks like an email address or a key", () => {
    const text = JSON.stringify(exportDocument(DID, rows(), AT));
    expect(text).not.toMatch(/[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i);
    expect(text).not.toMatch(/PRIVATE KEY|"d":|private_key/i);
  });
});
