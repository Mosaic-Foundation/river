// hubTemplates.ts: one fixture test per template (spec 4.2 Map). Each runs on a recorded activity
// from the seed hubs, except outcome_delivered, which they haven't sent: its activity is DERIVED
// from the recorded Create civic:Outcome (type changed to Announce).
import { describe, expect, it } from "vitest";
import { HUB_TEMPLATES, MAX_SUMMARY, templateText } from "../../../src/river/adapters/civicHub/hubTemplates.js";
import { mapActivity } from "../../../src/river/adapters/civicHub/index.js";
import { recordedActivity, type Activity } from "./helpers.js";

function summaryOf(activity: Activity | undefined): string | undefined {
  expect(activity).toBeDefined();
  return mapActivity(activity)?.item.summary;
}

const tested = new Set<string>();
function template(name: string, fn: () => void) {
  tested.add(name);
  it(name, fn);
}

describe("hub templates", () => {
  template("aggregation", () => {
    // Floyd's energy vote: result_summary plus participant_count.
    const vote = recordedActivity("Create", "hub:Aggregation", "civic.vote");
    expect(summaryOf(vote)).toMatch(/^Most approved: .+ · \d+ people took part$/);
    // A meeting summary has participant_count 0, so only result_summary shows.
    const meeting = recordedActivity("Create", "hub:Aggregation", "civic.meeting_summary");
    expect(summaryOf(meeting)).toMatch(/^\d+ topic blocks covering /);
  });

  template("meeting_summary", () => {
    const activity = recordedActivity("Announce", "civic:Result", "civic.meeting_summary")!;
    const title = ((activity.object["hub:payload"] as Record<string, unknown>).meeting_summary as Record<string, unknown>)
      .meeting_title as string;
    expect(title).toBeTruthy();
    expect(summaryOf(activity)).toBe(title);
  });

  template("brief", () => {
    const activity = recordedActivity("Announce", "civic:Result", "civic.brief")!;
    const headline = ((activity.object["hub:payload"] as Record<string, unknown>).brief as Record<string, unknown>).headline;
    expect(summaryOf(activity)).toBe(headline);
  });

  template("vote_result", () => {
    const activity = recordedActivity("Announce", "civic:Result", "civic.vote")!;
    const total = ((activity.object["hub:payload"] as Record<string, unknown>).result as Record<string, unknown>).total_votes;
    expect(summaryOf(activity)).toBe(`${total as number} votes`);
  });

  template("outcome_recorded", () => {
    const activity = recordedActivity("Create", "civic:Outcome", "civic.meeting_summary")!;
    expect(summaryOf(activity)).toBe((activity.object["hub:payload"] as Record<string, unknown>).outcome_description);
  });

  template("outcome_delivered", () => {
    const base = recordedActivity("Create", "civic:Outcome", "civic.meeting_summary")!;
    const derived = { ...base, id: `${base.id}-derived-announce`, type: "Announce" };
    expect(summaryOf(derived)).toBe((base.object["hub:payload"] as Record<string, unknown>).outcome_description);
  });

  template("official_response", () => {
    const activity = recordedActivity("Create", "hub:OfficialResponse", "civic.brief")!;
    const response = (activity.object["hub:payload"] as Record<string, unknown>).response as Record<string, unknown>;
    expect(summaryOf(activity)).toBe(`Response from the ${response.official_title as string}`);
    // Never a quote of what was said.
    expect(summaryOf(activity)).not.toContain(String(response.excerpt).slice(0, 20));
  });

  it("every template in hubTemplates.ts has a fixture test", () => {
    expect([...tested].sort()).toEqual(HUB_TEMPLATES.map((t) => t.name).sort());
  });

  it("reduces payload text to plain text and bounds it", () => {
    expect(templateText("Create", "civic:Outcome", { outcome_description: "<b>Done</b><script>x()</script> &amp; dusted" })).toBe(
      "Done & dusted",
    );
    const long = templateText("Create", "civic:Outcome", { outcome_description: "a".repeat(2000) })!;
    expect(long.length).toBe(MAX_SUMMARY);
    expect(templateText("Create", "civic:Outcome", { outcome_description: 42 })).toBeUndefined();
    expect(templateText("Create", "civic:Outcome", null)).toBeUndefined();
    expect(templateText("Create", "hub:Aggregation", { participant_count: 1 })).toBe("1 person took part");
  });
});
