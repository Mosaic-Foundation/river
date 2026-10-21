// Which hub activities show (spec 4.2, ADR-003). Closed by default: an activity that matches no
// row below is still stored, with hidden = true, and never shown. A new hub activity type stays
// invisible until someone adds a row here (with a test in tests/unit/civicHub/allowlist.test.ts).
//
// Rows are keyed by activity type, object type and, where it changes the wording, the context's
// civic:processType (from the hub's mapping table, civic-hub activitySerializer.ts:272-451). A row
// with a processType wins over the same activity and object without one.
import type { ItemKind } from "../../../shared/items/index.js";

export interface AllowRow {
  /** AS2 activity type as the hub sends it (compact: "Create", "civic:End"). */
  activity: string;
  /** The object's type. */
  object: string;
  /** context["civic:processType"], when the row only applies to one process type. */
  processType?: string;
  /** What the card says happened (spec 4.2 "Shown as"). */
  label: string;
  /** Item kind; civic unless the row says otherwise. */
  kind?: ItemKind;
  /** A final-result candidate (spec 4.2 stream end): Announce civic:Result, Create civic:Outcome. */
  finalCandidate?: boolean;
  /** civic:End: the stream ends. */
  endsStream?: boolean;
}

export const ALLOWLIST: readonly AllowRow[] = [
  { activity: "Create", object: "civic:Process", label: "A process opened" },
  { activity: "civic:Start", object: "civic:Process", label: "A process started" },
  { activity: "civic:End", object: "civic:Process", label: "A process ended", endsStream: true },
  // Hubs end a proposal or project with object civic:Process and say which in the processType;
  // the two rows below give those the table's wording.
  { activity: "civic:End", object: "civic:Process", processType: "civic.proposal", label: "A proposal closed", endsStream: true },
  { activity: "civic:End", object: "civic:Process", processType: "civic.project", label: "A project archived", endsStream: true },
  { activity: "civic:End", object: "civic:Proposal", label: "A proposal closed", endsStream: true },
  { activity: "civic:End", object: "hub:Project", label: "A project archived", endsStream: true },
  { activity: "Announce", object: "civic:Result", label: "Results published", finalCandidate: true },
  { activity: "Announce", object: "civic:Outcome", label: "An outcome delivered" },
  { activity: "Announce", object: "hub:SupportThreshold", label: "A proposal reached its support threshold" },
  { activity: "Create", object: "civic:Proposal", label: "A proposal submitted" },
  { activity: "Create", object: "civic:Outcome", label: "An outcome recorded", finalCandidate: true },
  { activity: "Create", object: "hub:Aggregation", label: "Results summarized" },
  { activity: "Create", object: "hub:Aggregation", processType: "civic.meeting_summary", label: "Results summarized", kind: "article" },
  { activity: "Create", object: "hub:OfficialResponse", label: "An official responded" },
  { activity: "Create", object: "hub:Project", label: "A project created" },
  { activity: "Update", object: "hub:Project", label: "A project updated" },
  { activity: "Offer", object: "hub:ProposedProcess", label: "A process proposed" },
];

/**
 * Shapes the spec names as hidden (spec 4.2 "Hidden"), as the hub sends them. None of them has a
 * row above; this list exists so a test proves each stays hidden if a row is ever added carelessly.
 */
export const KNOWN_HIDDEN: ReadonlyArray<{ activity: string; object: string; processType?: string; why: string }> = [
  { activity: "Create", object: "civic:Ballot", processType: "civic.vote", why: "ballot" },
  { activity: "Like", object: "civic:Proposal", processType: "civic.proposal", why: "support signal" },
  { activity: "Undo", object: "civic:Proposal", processType: "civic.proposal", why: "support withdrawn" },
  { activity: "Create", object: "Note", why: "comment" },
  { activity: "Create", object: "Note", processType: "civic.project", why: "project comment" },
  { activity: "Accept", object: "civic:Process", why: "review step" },
  { activity: "Reject", object: "civic:Process", why: "review step" },
  { activity: "TentativeReject", object: "civic:Process", why: "review step" },
  { activity: "Update", object: "civic:Process", processType: "civic.vote", why: "plain process update" },
  { activity: "Update", object: "civic:Process", processType: "civic.brief", why: "review update" },
  { activity: "Update", object: "civic:Process", processType: "civic.meeting_summary", why: "review update" },
  { activity: "Update", object: "civic:Process", processType: "civic.announcement", why: "plain process update" },
  { activity: "Update", object: "hub:ProjectSentiment", processType: "civic.project", why: "support signal" },
  { activity: "Create", object: "hub:Submission", why: "submission" },
];

/** The row for an activity, or undefined: closed by default, so undefined means hidden. */
export function allowRow(activity: string | undefined, object: string | undefined, processType?: string): AllowRow | undefined {
  if (!activity || !object) return undefined;
  let general: AllowRow | undefined;
  for (const row of ALLOWLIST) {
    if (row.activity !== activity || row.object !== object) continue;
    if (row.processType === undefined) general ??= row;
    else if (row.processType === processType) return row;
  }
  return general;
}
