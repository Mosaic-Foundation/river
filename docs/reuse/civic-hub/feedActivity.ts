// feedActivity.ts — THE single source of truth for "what is feed-worthy".
//
// Phase 3 of the 2026-06-25 consistency audit (decisions/
// audit-2026-06-25-process-and-feed-consistency.md §2). Before this module,
// the feed-worthiness decision was forked across FOUR drifting copies:
//   1. ui/src/components/Feed.tsx        (kindFromEvent — the inclusion gate)
//   2. ui/src/components/FeedPost.tsx    (eventToPost — the renderer)
//   3. ui/src/components/FeedFilter.tsx  (buildFilterPredicate — the ?type= filter)
//   4. src/modules/civic.digest/filter.ts (isDigestRenderable + classifyItemKind)
// They could not be diffed mechanically (a flat Set vs a data-shape switch)
// and had already drifted — generic "Activity" cards, a wordcloud mislabeled
// as a vote in the digest, proposals/projects/conversations visible in-app but
// absent from email. This module collapses all four into ONE classifier.
//
// SHARED ACROSS BOTH RUNTIMES — consumed by:
//   - the Vite frontend (Feed / FeedPost / FeedFilter), and
//   - the Node backend (civic.digest filter + service).
// It MUST therefore stay framework-agnostic and DEPENDENCY-FREE (no imports).
// Do NOT fork this logic back into the consumers — that drift is the bug this
// module exists to kill. Frontend imports it by relative path; the backend
// gets it via `src/**/*`.
//
// DESIGN — an explicit ALLOWLIST (default-CLOSED). Only event types named here
// produce a feed/digest card; everything else returns null. This is the seam
// for future admin-configurable feed-worthiness (good hardcoded defaults now;
// a config layer can later override the allowlist) and the reason adding
// `data.process.type` to non-feed-worthy emitters (comment_added,
// vote_submitted, moderation, …) does NOT surface them — the field is purely
// a discriminator; visibility is decided here.
//
// DISCRIMINATOR — the `civic.process.<verb>` family (started / result_published
// / created) does not carry the process type in `event_type`; multiple types
// emit the same event_type. We read `data.process.type` (set by every emitter
// via emitEvent) as the single discriminator, falling back to the legacy
// data-shape checks for historical events emitted before the field existed.

/**
 * Coarse content category — aligned 1:1 with the FeedFilter `?type=` keys so
 * the inclusion gate, the filter predicate, and the rendered pills can never
 * disagree (the "filter shows fewer than All" bug). Votes, vote-results,
 * wordclouds, proposals, projects, and conversations all live under
 * "activity"; announcements and meeting summaries get their own filter pill.
 */
export type ActivitySurface = "announcement" | "meeting_summary" | "activity";

/**
 * Fine-grained render variant. Each consumer maps this to its own presentation
 * tokens (the frontend → a FeedPillKind CSS class; the digest → a grouping +
 * pill color) via a total, exhaustively-checked switch — stable mappings, not
 * the brittle data-shape sniffing this module replaces.
 */
export type ActivityKind =
  | "vote-open"
  | "vote-closed" // a vote's own results, published when it closes (2026-10-07)
  | "vote-results" // legacy civic.vote_results records
  | "announcement" // admin / synced (Floyd County Gov)
  | "announcement-author" // board member / committee / other authored
  | "meeting"
  | "wordcloud"
  | "proposal"
  | "proposal-closed"
  | "project-created"
  | "project-updated"
  | "conversation"
  | "conversation-results" // legacy deliberation outcome delivered (close)
  | "brief" // universal civic.brief published — the final result of any process
  | "brief-response"; // an official responded to a published brief (anchored)

/**
 * THE color decision (2026-08-28, Adam): every surface colors a card, row,
 * or pill by the underlying PROCESS TYPE, not by the event's lifecycle
 * moment — a proposal is proposal-purple as "New proposal", as "Proposal
 * results", and on its Outcomes row. Kinds collapse onto these keys here,
 * in the same shared classifier that owns feed-worthiness, so the feed,
 * the Outcomes index, and the email digest can never disagree again
 * (they previously kept three drifting palettes keyed by kind).
 *
 * Each key maps to a `--type-<key>-bg/-fg` token pair in the UI's
 * theme.css and a literal hex pair in civic.digest/service.ts
 * PILL_COLORS (emails cannot read CSS variables).
 *
 * Two non-process keys on purpose: "announcement-author" preserves the
 * elected-official vs hub-admin announcement distinction, and
 * "official-response" is an ACT (the government answering a brief), not
 * a process — it keeps its gold everywhere.
 */
export type ActivityColor =
  | "vote"
  | "proposal"
  | "conversation"
  | "project"
  | "wordcloud"
  | "announcement"
  | "announcement-author"
  | "meeting"
  | "official-response"
  | "generic";

export interface Activity {
  surface: ActivitySurface;
  kind: ActivityKind;
  /** Process-type color key — see ActivityColor above. */
  color: ActivityColor;
  /**
   * Canonical, hub-config-free pill label. Single source of truth for both
   * the feed card pill and the email digest pill — so they read identically
   * for the same event. (Announcement labels are role-aware and derived
   * purely from the event payload, so they belong here too.)
   */
  pill: string;
  /**
   * A brief's source process type (kind "brief" only), so a reader that
   * knows the hub can word its pill: a vote's brief is "Brief to the
   * Supervisors" on the feed (Adam, 2026-10-07; briefPillFor in hubCopy).
   */
  briefSource?: string;
  /**
   * Where the card links. Either a dedicated relative SPA path (wordcloud /
   * proposal / conversation, whose public page differs from /process/:id) or
   * the event's own `action_url` verbatim — which may be an absolute external
   * URL (e.g. a synced Floyd-news announcement) that MUST be preserved. The
   * frontend routes it through classifyHref; the digest absolutizes relative
   * paths against the hub UI base.
   */
  href: string;
}

/**
 * Minimal structural view of a civic event. Both the frontend `CivicEvent`
 * and the backend `DigestEvent` are assignable to this, so neither consumer
 * has to adapt its event shape before calling `classifyActivity`.
 */
export interface ClassifierEvent {
  event_type: string;
  process_id: string;
  action_url: string;
  data: Record<string, unknown>;
}

/**
 * Resolve the underlying process type for an event. Prefers the canonical
 * `data.process.type` (stamped by emitEvent for the whole civic.process.*
 * family); falls back to the Polis handler's flat `data.process_type`
 * convention so historical deliberation events still discriminate correctly.
 * Returns undefined for events that carry no type (legacy votes) — callers
 * then fall back to data-shape checks.
 */
function processTypeOf(event: ClassifierEvent): string | undefined {
  const data = event.data ?? {};
  const nested = (data.process as { type?: unknown } | undefined)?.type;
  if (typeof nested === "string") return nested;
  const flat = (data as { process_type?: unknown }).process_type;
  if (typeof flat === "string") return flat;
  return undefined;
}

/**
 * The only event types `classifyActivity` can return a card for: the cases of
 * its switch below that are not always null. The feed asks the database for
 * these types alone (2026-10-07), so a page of cards is not a scan through
 * every ballot and comment. A unit test (feedActivity.test.ts) fails if the
 * classifier returns a card for any other type, so the list cannot fall
 * behind the switch.
 */
export const FEED_EVENT_TYPES: readonly string[] = [
  "civic.process.started",
  "civic.process.result_published",
  "civic.process.created",
  "civic.process.action_taken",
  "civic.proposal.submitted",
  "civic.project.created",
  "civic.project.updated",
  "civic.outcome_delivered",
];

/**
 * Classify a civic event into its feed/digest presentation, or null when the
 * event is not feed-worthy. The ONE predicate the gate, renderer, filter, and
 * digest all share.
 */
export function classifyActivity(event: ClassifierEvent): Activity | null {
  const eventType = event.event_type;
  const id = event.process_id;
  const processType = processTypeOf(event);

  // Review-lifecycle events are restricted admin/creator correspondence —
  // admins receive them on the events endpoint for the moderation log, but
  // they are never public activity. Excluded regardless of viewer.
  if (eventType.startsWith("civic.review.")) return null;

  switch (eventType) {
    case "civic.process.started":
      return classifyStarted(event, processType, id);

    case "civic.process.result_published":
      return classifyResultPublished(event, processType, id);

    case "civic.process.created":
      // Only conversations post a "created" card. Votes post when they open
      // (civic.process.started); proposals/projects post via their own
      // civic.<type>.* events — so created is null for everything else, which
      // is what prevents double-posting.
      if (processType === "civic.polis_deliberation") {
        return {
          surface: "activity",
          kind: "conversation",
          color: "conversation",
          pill: "New conversation",
          href: `/deliberation/${id}`,
        };
      }
      return null;

    case "civic.process.action_taken":
      // An official's public response to a published brief. Every response
      // emits this event (the log is never throttled), but only the ANCHOR
      // — stamped by the write path when no other response to the same
      // brief anchored a card in the last 24h — renders in the feed and
      // digest, so a burst of responses is one card. Suppressed responses
      // still reach readers: the card links to /brief/:id, which shows
      // them all. Any other action_taken stays default-closed.
      if (
        processType === "civic.brief" &&
        event.data?.action === "official_response" &&
        event.data?.feed_anchor === true
      ) {
        return {
          surface: "activity",
          kind: "brief-response",
          color: "official-response",
          pill: "Official response",
          href: `/brief/${id}`,
        };
      }
      return null;

    case "civic.proposal.submitted":
      return {
        surface: "activity",
        kind: "proposal",
        color: "proposal",
        pill: "New proposal",
        href: `/proposal/${id}`,
      };

    case "civic.proposal.closed":
      // Deliberately silent in the feed (Adam, 2026-08-26). A closing proposal
      // used to post its own card AND then its published brief posted another,
      // so one proposal produced two cards saying much the same thing. The
      // brief is the better of the two: the "closed" card sent a reader to a
      // finished proposal with no outcome on it yet.
      //
      // This makes all three process types behave alike — a vote closing has
      // never posted a card, and conversations dropped theirs for the same
      // reason (see shared/polis_deliberation/handler.ts). Publication of the
      // brief is the announcement that a process has concluded.
      //
      // The EVENT still fires and is still on the wire; only the feed card is
      // withheld. Proposals closed before this change keep their existing
      // cards, since the feed is a projection of an append-only log.
      return null;

    case "civic.project.created":
      return {
        surface: "activity",
        kind: "project-created",
        color: "project",
        pill: "New project",
        href: event.action_url,
      };

    case "civic.project.updated":
      return {
        surface: "activity",
        kind: "project-updated",
        color: "project",
        pill: "Project update",
        href: event.action_url,
      };

    case "civic.outcome_delivered": {
      // Part C — deliberation close. Previously an orphan that rendered as a
      // bland "Activity" card in the feed and was absent from the digest.
      const origin =
        typeof event.data?.originating_process_id === "string"
          ? event.data.originating_process_id
          : id;
      return {
        surface: "activity",
        kind: "conversation-results",
        color: "conversation",
        pill: "Conversation results",
        href: `/deliberation/${origin}`,
      };
    }

    default:
      // Default-CLOSED. Everything not named above — civic.process.updated /
      // ended / vote_submitted / comment_added / aggregation_completed /
      // outcome_recorded / proposed / threshold_met, civic.proposal.supported
      // / endorsed / converted, civic.project.archived / comment_added /
      // sentiment_changed, etc. — is intentionally not feed-worthy.
      return null;
  }
}

function classifyStarted(
  event: ClassifierEvent,
  processType: string | undefined,
  id: string,
): Activity | null {
  // Conversations post their card on `created`, not `started` — exclude here
  // to avoid a double-post (and to fix the legacy mislabel where a
  // deliberation start fell through to the vote branch below).
  if (processType === "civic.polis_deliberation") return null;

  const data = event.data ?? {};
  if (
    processType === "civic.wordcloud" ||
    data.wordcloud_snapshot !== undefined ||
    data.wordcloud_result !== undefined
  ) {
    return {
      surface: "activity",
      kind: "wordcloud",
      color: "wordcloud",
      pill: "Word cloud",
      href: `/wordcloud/${id}`,
    };
  }

  // Votes — explicit type, or legacy vote events that predate data.process.type
  // (undefined). civic.process.started is otherwise only emitted by votes.
  if (processType === "civic.vote" || processType === undefined) {
    return {
      surface: "activity",
      kind: "vote-open",
      color: "vote",
      pill: "Vote open",
      href: event.action_url,
    };
  }

  // A new process type emitting `started` we don't recognize — default-closed.
  return null;
}

function classifyResultPublished(
  event: ClassifierEvent,
  processType: string | undefined,
  id: string,
): Activity | null {
  const data = event.data ?? {};

  // Universal brief published — the final result of ANY closed process.
  // Checked first (by processType) so it never falls through to the legacy
  // vote-results branch. The pill names the process that completed.
  if (processType === "civic.brief") {
    const brief = (data.brief ?? {}) as { source_process_type?: unknown };
    const srcType =
      typeof brief.source_process_type === "string"
        ? brief.source_process_type
        : "";
    return {
      surface: "activity",
      kind: "brief",
      color: briefColorOf(srcType),
      pill: briefPill(srcType),
      briefSource: srcType,
      href: `/brief/${id}`,
    };
  }

  if (
    processType === "civic.wordcloud" ||
    data.wordcloud_snapshot !== undefined ||
    data.wordcloud_result !== undefined
  ) {
    return {
      surface: "activity",
      kind: "wordcloud",
      color: "wordcloud",
      pill: "Word cloud",
      href: `/wordcloud/${id}`,
    };
  }

  if (processType === "civic.announcement" || data.announcement !== undefined) {
    return classifyAnnouncement(data, event.action_url);
  }

  if (
    processType === "civic.meeting_summary" ||
    data.meeting_summary !== undefined ||
    typeof data.summary_id === "string"
  ) {
    return {
      surface: "meeting_summary",
      kind: "meeting",
      color: "meeting",
      pill: "Meeting summary",
      href: event.action_url,
    };
  }

  if (
    processType === "civic.vote_results" ||
    typeof data.results_id === "string" ||
    typeof data.brief_id === "string"
  ) {
    return {
      surface: "activity",
      kind: "vote-results",
      color: "vote",
      pill: "Vote results",
      href: event.action_url,
    };
  }

  // A vote's own results, published when it closes (since 2026-10-07: a vote
  // finishes on its own; its brief is separate and posts its own card).
  if (processType === "civic.vote" && data.results_at_close === true) {
    return {
      surface: "activity",
      kind: "vote-closed",
      color: "vote",
      pill: "Vote results",
      href: event.action_url,
    };
  }

  // Any other raw vote-process result_published — INTENTIONALLY excluded.
  // Before 2026-10-07 a vote was finalized by approving its brief (or its
  // civic.vote_results record), and that card announced the result; the
  // vote's own event stays on the log for audit/federation.
  if (processType === "civic.vote" || data.result !== undefined) return null;

  // Unknown shape — default-closed (was a bland "Activity" card before Phase 3).
  return null;
}

/**
 * Context line for an official-response card — names WHAT is being
 * responded to: the community's record of a completed process. Shared by
 * the feed card (metadata line) and the email digest (row summary) so the
 * two can never phrase it differently. The card deliberately carries NO
 * excerpt of the response itself: a truncated quote can misrepresent an
 * official statement, and the card links to the brief where the full
 * response reads in context.
 */
export function briefResponseContext(sourceType: unknown): string {
  const noun = briefSourceNoun(
    typeof sourceType === "string" ? sourceType : "",
  );
  return `Responding to the community's Civic Brief on this ${noun}`;
}

/** Color key for a brief (or its response context) — the brief wears its
 *  SOURCE process's color, which is what makes the Outcomes page and the
 *  feed agree. Unknown sources stay neutral rather than wrong. */
function briefColorOf(sourceType: string): ActivityColor {
  switch (sourceType) {
    case "civic.polis_deliberation":
      return "conversation";
    case "civic.vote":
      return "vote";
    case "civic.proposal":
      return "proposal";
    case "civic.project":
      return "project";
    case "civic.wordcloud":
      return "wordcloud";
    default:
      return "generic";
  }
}

/** Reader-facing noun for a brief's source process type. */
function briefSourceNoun(sourceType: string): string {
  switch (sourceType) {
    case "civic.polis_deliberation":
      return "conversation";
    case "civic.vote":
      return "vote";
    case "civic.proposal":
      return "proposal";
    case "civic.project":
      return "project";
    default:
      return "process";
  }
}

/** Per-source-type pill for a published brief — names the process that
 *  completed, so residents see what kind of thing wrapped up. */
function briefPill(sourceType: string): string {
  switch (sourceType) {
    case "civic.polis_deliberation":
      return "Conversation results";
    case "civic.vote":
      // The vote posts its own "Vote results" card when it closes; its
      // brief is a separate post (2026-10-07).
      return "Vote brief";
    case "civic.proposal":
      return "Proposal results";
    case "civic.project":
      return "Project completed";
    default:
      return "Civic Brief";
  }
}

function classifyAnnouncement(
  data: Record<string, unknown>,
  actionUrl: string,
): Activity {
  const ann = data.announcement as
    | { author_role?: unknown; source?: { origin?: unknown } | null }
    | undefined;
  const rawRole =
    typeof ann?.author_role === "string" ? ann.author_role : null;
  // Legacy "board" → "Board member"; lowercase "admin"/unset → "Admin"; any
  // other free-form role ("Planning Committee", …) is shown verbatim.
  const normalized =
    rawRole === "board"
      ? "Board member"
      : rawRole === "admin" || !rawRole
        ? "Admin"
        : rawRole;
  const isAdmin = normalized === "Admin";
  // Synced-from-external announcements (the news-sync cron, e.g. Floyd County
  // Gov) reuse the admin palette so they group with admin-authored ones under
  // the same filter pill. Keyed on the presence of `source`, not on its
  // origin string: only a sync writes one, and the origin value changed when
  // the module was renamed, so older rows carry a different one.
  const isSynced = Boolean(ann?.source);
  return {
    surface: "announcement",
    // Non-admin authors (board members, committees) get a distinct pill +
    // border color so residents can tell elected-official posts from the hub
    // administrator's.
    kind: isAdmin || isSynced ? "announcement" : "announcement-author",
    color: isAdmin || isSynced ? "announcement" : "announcement-author",
    pill: abbreviateGovernment(normalized),
    href: actionUrl,
  };
}

/**
 * Width-saver for announcement pill labels: "Floyd County Government" →
 * "Floyd County Gov". Single source of truth for both the feed and the email
 * digest (previously duplicated in FeedPost.tsx and digest/service.ts).
 */
function abbreviateGovernment(label: string): string {
  return label.replace(/\bGovernment\b/gi, "Gov");
}

/**
 * One line of a vote's final count for a card or digest row, most votes
 * first: "Yes 12 · No 5 · Unsure 1". Empty when the event carries no tally
 * or nobody voted.
 * Options are stored by their label, so the keys read as written.
 */
export function voteResultLine(data: Record<string, unknown> | undefined): string {
  const result = (data?.result ?? {}) as { tally?: unknown };
  const tally = result.tally;
  if (!tally || typeof tally !== "object") return "";
  const counts = Object.entries(tally as Record<string, unknown>).filter(
    (e): e is [string, number] => typeof e[1] === "number",
  );
  if (counts.every(([, n]) => n === 0)) return "";
  return counts
    .sort((a, b) => b[1] - a[1])
    .map(([option, count]) => `${option} ${count}`)
    .join(" · ");
}
