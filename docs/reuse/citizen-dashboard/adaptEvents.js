// CivicEvent → feed-item adapter (A3).
//
// Takes classified live events and produces objects in the exact shape the
// existing demo feed uses ({ id, hubId, type, title, preview, fullContent,
// author, timestamp, tags, isRead }) plus three live-only fields:
//   actionUrl — absolute click-through target (the proof of real connection)
//   live      — marks the item for the live chip + CTA behavior
//   sortAt    — numeric ms timestamp so the blend sorts cleanly while the
//               displayed relative strings stay human ("2h ago")

import { classifyActivity } from "./feedActivity.ts";

/** ActivityKind → existing feed-item `type` vocabulary (Icons.jsx map). */
const KIND_TO_TYPE = {
  "vote-open": "vote",
  "vote-results": "vote-result",
  announcement: "update",
  "announcement-author": "update",
  meeting: "meeting",
  wordcloud: "poll",
  proposal: "proposal",
  "proposal-closed": "proposal",
  "project-created": "update",
  "project-updated": "update",
  conversation: "poll",
  "conversation-results": "update",
  position: "update",
  "outcome-received": "vote-result",
  "entity-response": "comment",
  "issue-raised": "comment",
  "issue-responded": "comment",
};

export function relativeTime(iso, now = Date.now()) {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Opaque actor id → display name. DID-compatible strings and the demo's
 * email-style ids both reduce to something readable. */
export function friendlyActor(actor) {
  if (typeof actor !== "string" || !actor) return "Unknown";
  if (actor.startsWith("did:web:")) return actor.slice("did:web:".length).split(":")[0];
  if (actor.startsWith("did:")) return actor.split(":").pop();
  if (actor.includes("@")) return actor.split("@")[0].replace(/[._]/g, " ");
  return actor;
}

const str = (v) => (typeof v === "string" && v.trim() ? v : null);

/**
 * The real title of the thing an event points at. Hub events nest it in a
 * per-type payload object (data.process.title on lifecycle events,
 * data.proposal/.project/.announcement.title, meeting_summary.meeting_title);
 * Rep Space events use flat data.title / data.topic.
 */
function titleOf(data) {
  return (
    str(data.title) ??
    str(data.topic) ??
    str(data.process?.title) ??
    str(data.proposal?.title) ??
    str(data.project?.title) ??
    str(data.announcement?.title) ??
    str(data.meeting_summary?.meeting_title) ??
    null
  );
}

function headline(event, activity) {
  const data = event.data ?? {};
  const title = titleOf(data);

  switch (activity.kind) {
    case "position":
      return data.topic ? `New position: ${data.topic}` : "Published a position statement";
    case "outcome-received":
      return "A civic outcome was delivered to this representative";
    case "entity-response":
      return "The representative responded to a civic outcome";
    case "issue-raised":
      return title ? `Constituent issue: ${title}` : "New entry on the issue board";
    case "issue-responded":
      return "The representative answered an issue board entry";
    case "vote-open":
      return title ? `Vote open: ${title}` : "A new advisory vote is open";
    case "vote-results":
      return title ? `Results: ${title}` : "Vote results published";
    case "conversation":
      return title ?? "A new conversation is open";
    case "meeting":
      return title
        ? `Meeting summary: ${title}`
        : "A meeting summary was published";
    default:
      return title ?? activity.pill;
  }
}

function preview(event, activity, sourceName) {
  const data = event.data ?? {};
  // Rep Space events sometimes carry body text; hub events are pointers
  // (title + counts only), so most fall through to kind-aware phrasing.
  const detail =
    str(data.statement) ??
    str(data.outcome_summary) ??
    str(data.body) ??
    str(data.framing);
  if (detail) return detail;

  switch (activity.kind) {
    case "proposal":
      return "A new proposal is collecting community support. Open it to read the full text and add yours.";
    case "proposal-closed":
      return "This proposal's support window has closed. Open it to see how it did.";
    case "project-created":
      return "A community project was published. Open it to see the plan and show your support.";
    case "project-updated":
      return "This community project posted an update.";
    case "conversation":
      return "A community conversation is open — read statements, vote on them, and add your own.";
    case "conversation-results":
      return "This conversation closed and its results are ready to read.";
    case "vote-open":
      return "Voting is open. Cast your ballot before it closes.";
    case "vote-results":
      return "The results are in. Open them to see the tally.";
    case "announcement":
    case "announcement-author": {
      const author =
        str(data.announcement?.author_display_name) ??
        str(data.announcement?.author_role);
      return author ? `Posted by ${author}.` : `An announcement from ${sourceName}.`;
    }
    case "meeting": {
      const date = str(data.meeting_summary?.meeting_date) ?? str(data.meeting_date);
      return date
        ? `Summary of the ${date} meeting — decisions, votes, and discussion.`
        : "A public meeting summary — decisions, votes, and discussion.";
    }
    default:
      return `Live from ${sourceName}. Open it there to see details and participate.`;
  }
}

/**
 * Adapt one source's events into feed items. Non-feed-worthy events
 * (classifier returns null) and malformed entries are dropped.
 *
 * @param {Array<object>} events CivicEvent[]
 * @param {{ id: string, name: string }} source entry from LIVE_SOURCES
 */
export function adaptEvents(events, source) {
  const items = [];
  if (!Array.isArray(events)) return items;

  for (const event of events) {
    if (!event || typeof event !== "object") continue;
    if (typeof event.event_type !== "string" || typeof event.id !== "string") continue;

    let activity;
    try {
      activity = classifyActivity(event);
    } catch {
      continue; // a malformed event must never take the feed down
    }
    if (!activity) continue;

    const sortAt = Date.parse(event.timestamp);
    if (!Number.isFinite(sortAt)) continue;

    // Classifier hrefs are absolute for entity events; hub SPA paths
    // (/deliberation/:id …) are relative — absolutize against the event's
    // own absolute action_url so the click-through always leaves the
    // dashboard correctly.
    let actionUrl = activity.href;
    try {
      actionUrl = new URL(activity.href, event.action_url).toString();
    } catch {
      actionUrl = event.action_url;
    }

    // Stored events are immutable, and some production data was emitted
    // before the services' UI base env vars were set — those events carry
    // localhost action_urls forever. When we know the source's real UI
    // origin (and it isn't itself localhost), transplant the path onto it.
    if (source.uiOrigin && !source.uiOrigin.startsWith("http://localhost")) {
      try {
        const parsed = new URL(actionUrl);
        if (/^localhost$|^127\.0\.0\.1$/.test(parsed.hostname)) {
          actionUrl = source.uiOrigin + parsed.pathname + parsed.search + parsed.hash;
        }
      } catch {
        actionUrl = source.homeUrl ?? actionUrl;
      }
    }

    const body = preview(event, activity, source.name);
    const announcementAuthor =
      str(event.data?.announcement?.author_display_name) ??
      str(event.data?.announcement?.author_role);

    items.push({
      id: event.id,
      hubId: source.id,
      type: KIND_TO_TYPE[activity.kind] ?? "update",
      title: headline(event, activity),
      preview: body,
      fullContent: body,
      author: announcementAuthor ?? friendlyActor(event.actor),
      timestamp: relativeTime(event.timestamp),
      tags: [activity.pill],
      isRead: false,
      live: true,
      actionUrl,
      sortAt,
    });
  }

  return items;
}
