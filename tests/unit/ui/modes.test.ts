// The UI's mode and panel helpers (spec F9, 4.7; checks 7 and 8, UI logic part).
import { describe, expect, it } from "vitest";
import { feedSearch } from "../../../ui/src/lib/api";
import {
  dateEntryDetail,
  modeFromSearch,
  pluginTag,
  showModeSwitch,
  themeForMode,
  waitingOnText,
  withMode,
} from "../../../ui/src/lib/modes";

describe("mode switch and links", () => {
  it("shows the switch only for more than one mode (check 8)", () => {
    expect(showModeSwitch([{ id: "civic", title: "Civic" }])).toBe(false);
    expect(showModeSwitch([])).toBe(false);
    expect(
      showModeSwitch([
        { id: "everything", title: "Everything" },
        { id: "civic", title: "Civic" },
      ]),
    ).toBe(true);
  });

  it("keeps the mode in links, before any hash", () => {
    expect(withMode("/following", "civic")).toBe("/following?mode=civic");
    expect(withMode("/following#follow", "civic")).toBe("/following?mode=civic#follow");
    expect(withMode("/?circle=Civic", "civic")).toBe("/?circle=Civic&mode=civic");
    expect(withMode("/following", "")).toBe("/following");
  });

  it("reads ?mode= and ignores anything that isn't a mode name", () => {
    expect(modeFromSearch("?mode=Civic&circle=x")).toBe("civic");
    expect(modeFromSearch("")).toBe("");
    expect(modeFromSearch("?mode=%3Cscript%3E")).toBe("");
  });

  it("sends the mode to the feed API", () => {
    expect(feedSearch({ mode: "civic", circles: [], types: [] })).toBe("?mode=civic");
    expect(feedSearch({ mode: "", types: ["events"] })).toBe("?type=events");
  });

  it("gives the Following page the mode's theme", () => {
    expect(themeForMode("civic")).toBe("civic");
    expect(themeForMode("everything")).toBe("mosaic");
    expect(themeForMode("")).toBe("mosaic");
  });
});

describe("panel words", () => {
  it("tags plugins and slots, and names what a slot waits on", () => {
    expect(pluginTag({ type: "dates", intro: "", entries: [] })).toBe("Plugin");
    expect(pluginTag({ type: "placeholder", text: "", waitingOn: [] })).toBe("Plugin slot");
    expect(waitingOnText(["Open States", "Geocodio", "Cicero"])).toBe(
      "Waiting on a data source (Open States, Geocodio or Cicero).",
    );
    expect(waitingOnText(["Democracy Works", "Ballotpedia"])).toBe(
      "Waiting on a data source (Democracy Works or Ballotpedia).",
    );
    expect(waitingOnText(["Ballotpedia"])).toBe("Waiting on a data source (Ballotpedia).");
  });

  it("says what a Coming up date is", () => {
    const base = { date: "2026-11-08T05:00:47.238Z", title: "Vote", itemId: "x", url: null, source: "live" as const };
    expect(dateEntryDetail({ ...base, what: "deadline", spaceName: "Longmont Civic Hub" })).toBe(
      "Voting closes · Longmont Civic Hub",
    );
    expect(dateEntryDetail({ ...base, what: "event", spaceName: "Elm Street Neighbors" })).toBe(
      "Starts · Elm Street Neighbors",
    );
  });
});
