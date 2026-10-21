// Per-type card text for hub activities (spec 4.2 Map). Hubs send no AS2 `summary` yet, so the
// readable line comes from named `hub:payload` keys. Every template is here, in one place, with a
// fixture test each (tests/unit/civicHub/hubTemplates.test.ts). The text is data from another
// server: it is reduced to plain text and never read as instructions.
import { toPlainText } from "../../../shared/sanitize/index.js";

type Payload = Record<string, unknown>;

export interface HubTemplate {
  /** Stable name, used by the tests. */
  name: string;
  activity: string;
  object: string;
  /** The text, or undefined when the payload lacks the keys (the next template is tried). */
  text(payload: Payload): string | undefined;
}

/** Longest summary kept; hub payload strings are short, this only bounds a misbehaving hub. */
export const MAX_SUMMARY = 500;

function record(value: unknown): Payload | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const plain = toPlainText(value);
  return plain ? plain : undefined;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const HUB_TEMPLATES: readonly HubTemplate[] = [
  {
    // Votes, briefs and meeting summaries: "Most approved: ... (15 of 33 voters, 45%) · 33 people took part".
    name: "aggregation",
    activity: "Create",
    object: "hub:Aggregation",
    text(p) {
      const summary = text(p.result_summary);
      const people = count(p.participant_count);
      const took = people ? `${plural(people, "person", "people")} took part` : undefined;
      return [summary, took].filter(Boolean).join(" · ") || undefined;
    },
  },
  {
    // A published meeting summary: the meeting's own title ("Public Hearing").
    name: "meeting_summary",
    activity: "Announce",
    object: "civic:Result",
    text: (p) => text(record(p.meeting_summary)?.meeting_title),
  },
  {
    // A published brief: its headline.
    name: "brief",
    activity: "Announce",
    object: "civic:Result",
    text: (p) => text(record(p.brief)?.headline),
  },
  {
    // A vote's own result: how many voted (the tally itself is on the hub).
    name: "vote_result",
    activity: "Announce",
    object: "civic:Result",
    text(p) {
      const votes = count(record(p.result)?.total_votes);
      return votes === undefined ? undefined : plural(votes, "vote", "votes");
    },
  },
  {
    name: "outcome_recorded",
    activity: "Create",
    object: "civic:Outcome",
    text: (p) => text(p.outcome_description),
  },
  {
    name: "outcome_delivered",
    activity: "Announce",
    object: "civic:Outcome",
    text: (p) => text(p.outcome_description),
  },
  {
    // Who responded, not what they said: a cut-down quote can misrepresent an official statement
    // (the hub's own rule); the card links to the brief where the response reads in full.
    name: "official_response",
    activity: "Create",
    object: "hub:OfficialResponse",
    text(p) {
      const title = text(record(p.response)?.official_title);
      return title ? `Response from the ${title}` : undefined;
    },
  },
];

/** The summary line for an activity, from the first template that matches and has its keys. */
export function templateText(activity: string, object: string, payload: unknown): string | undefined {
  const p = record(payload);
  if (!p) return undefined;
  for (const template of HUB_TEMPLATES) {
    if (template.activity !== activity || template.object !== object) continue;
    const out = template.text(p);
    if (out) return out.length > MAX_SUMMARY ? `${out.slice(0, MAX_SUMMARY - 1)}…` : out;
  }
  return undefined;
}
