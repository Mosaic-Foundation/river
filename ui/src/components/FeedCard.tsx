// One feed card (spec F1, F4, 4.8). Text is rendered as text; the item's contentHtml, already
// sanitized on the server by src/shared/sanitize/, is the only HTML (CLAUDE.md constraint 8).
// A click anywhere on the card opens the item in the reader view (ui-revisions-1 item 1), except on
// the card's own links and buttons; from the keyboard, the title (or, without one, the time) is
// a link to /item/{id}. The footer names the source host only. Older activities of the same hub
// process fold into the card under "N earlier updates" (ui-revisions-1 item 7); Mark read then
// covers them all. A boost whose post the refresh fetched shows that post under its original
// author's name and avatar, with "{booster} boosted" above (spec 4.3); otherwise it keeps the
// plain "{booster} boosted a post from {host}" card.
import type { FeedItem } from "../lib/api";
import { boostedPost, boosterName } from "../lib/boost";
import {
  deadlineLabel,
  eventDate,
  formatDuration,
  fullDateTime,
  kindLabel,
  linkHost,
  processKey,
  relativeTime,
} from "../lib/format";
import { CardMedia } from "./CardMedia";
import { CARD_INTERACTIVE, isNewTabClick, itemPath } from "../lib/reader";
import { BoostIcon } from "./Icons";
import { SourceIcon } from "./SourceIcon";

export interface FeedCardProps {
  item: FeedItem;
  read: boolean;
  now: number;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onSampleInfo: (trigger: HTMLButtonElement) => void;
  /** Opens the item in the reader view. */
  onOpen: (id: string) => void;
  /** Older activities of the same hub process, newest first (ui-revisions-1 item 7). */
  earlier?: FeedItem[];
}

/** The card's link to the reader view: a plain click stays in the page, a modified one opens a tab. */
function openHandler(id: string, onOpen: (id: string) => void) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isNewTabClick(e)) return;
    e.preventDefault();
    onOpen(id);
  };
}

/** Spec F4: links open in a new tab with rel="noopener noreferrer" (the sanitizer sets rel). */
function openLinksInNewTab(el: HTMLDivElement | null): void {
  el?.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    a.target = "_blank";
    a.rel = "nofollow noopener noreferrer";
  });
}

export function FeedCard({ item, read, now, onMarkRead, onMarkUnread, onSampleInfo, onOpen, earlier = [] }: FeedCardProps) {
  const titleId = `item-${item.id}-title`;
  const host = item.source === "live" ? linkHost(item.url) : undefined;
  const boosted = boostedPost(item);
  const sourceName = boosted ? boosted.name : item.space.name;
  const sourceIcon = boosted ? (boosted.author?.iconUrl ?? null) : item.space.iconUrl;
  const duration = formatDuration(item.media.find((m) => m.duration)?.duration, item.kind);
  const event = eventDate(item.event?.startTime);
  const deadline = deadlineLabel(item.civic?.deadline);
  const civicLabel = item.kind === "civic" || item.civic ? item.civic?.label : undefined;
  const process = processKey(item.civic);
  const text = item.contentHtml ? undefined : item.summary;
  const href = itemPath(item.id, window.location.search);
  const open = openHandler(item.id, onOpen);

  return (
    <article
      className={read ? "card" : "card card-unread"}
      aria-labelledby={item.title ? titleId : undefined}
      aria-label={item.title ? undefined : `${kindLabel(item.kind)} from ${sourceName}`}
      data-testid="feed-card"
      data-item-id={item.id}
      data-source={item.source}
      data-kind={item.kind}
      data-adapter={item.space.adapter}
      data-process={process}
      data-group-size={1 + earlier.length}
      onClick={(e) => {
        // The card's own links and buttons keep their behavior; selecting text doesn't open it.
        if ((e.target as Element).closest(CARD_INTERACTIVE)) return;
        if (window.getSelection()?.toString()) return;
        onOpen(item.id);
      }}
    >
      {boosted && (
        <p className="card-boost" data-testid="boost-line">
          <BoostIcon />
          {boosted.booster} boosted
        </p>
      )}

      <header className="card-header">
        <SourceIcon name={sourceName} iconUrl={sourceIcon} />
        <div className="card-byline">
          <span className="card-source">{sourceName}</span>
          <span className="card-meta">
            <span className="card-kind">{kindLabel(item.kind)}</span>
            <span aria-hidden="true"> · </span>
            {item.title ? (
              <time dateTime={item.publishedAt} title={fullDateTime(item.publishedAt)}>
                {relativeTime(item.publishedAt, now)}
              </time>
            ) : (
              <a
                className="card-permalink"
                href={href}
                onClick={open}
                aria-label={`Read ${kindLabel(item.kind).toLowerCase()} from ${sourceName}, ${relativeTime(item.publishedAt, now)}`}
              >
                <time dateTime={item.publishedAt} title={fullDateTime(item.publishedAt)}>
                  {relativeTime(item.publishedAt, now)}
                </time>
              </a>
            )}
          </span>
        </div>
        <div className="card-flags">
          {item.source === "sample" ? (
            <button
              type="button"
              className="label label-sample"
              aria-haspopup="dialog"
              onClick={(e) => onSampleInfo(e.currentTarget)}
            >
              Sample
            </button>
          ) : (
            <span className="label label-live">Live</span>
          )}
          {!read && (
            <span className="unread-dot" data-testid="unread-dot">
              <span className="visually-hidden">Unread</span>
            </span>
          )}
        </div>
      </header>

      {item.boostOf && !boosted && (
        <p className="card-boost">
          <BoostIcon />
          {boosterName(item)} boosted a post from {item.boostOf.host}
        </p>
      )}

      {item.title && (
        <h2 className="card-title" id={titleId}>
          <a className="card-title-link" href={href} onClick={open}>
            {item.title}
          </a>
        </h2>
      )}

      {item.contentHtml && (
        // Sanitized server-side (Appendix B allowlist); nothing else uses this.
        <div
          className="card-text card-html"
          ref={openLinksInNewTab}
          onClick={(e) => {
            if ((e.target as Element).closest("a[href]")) onMarkRead(item.id);
          }}
          dangerouslySetInnerHTML={{ __html: item.contentHtml }}
        />
      )}
      {text && <p className="card-text">{text}</p>}
      {item.boostOf && !boosted && !item.contentHtml && !text && (
        <p className="card-text card-muted">The boosted post opens where it lives.</p>
      )}

      {event && (
        <p className="card-event">
          <span className="card-event-date" aria-hidden="true">
            <span className="card-event-month">{event.month}</span>
            <span className="card-event-day">{event.day}</span>
          </span>
          <span className="card-event-detail">
            <time dateTime={event.dateTime}>{event.label}</time>
            {item.event?.location && <span className="card-event-place">{item.event.location}</span>}
          </span>
        </p>
      )}

      <CardMedia media={item.media} />

      {(civicLabel || deadline || duration || item.isFinalResult) && (
        <ul className="card-chips" aria-label="Details">
          {civicLabel && <li className={process ? "chip-static chip-process" : "chip-static"}>{civicLabel}</li>}
          {deadline && <li className="chip-static chip-deadline">{deadline}</li>}
          {item.isFinalResult && <li className="chip-static chip-final">Final result</li>}
          {duration && (
            <li className="chip-static">
              <span className="visually-hidden">Length: </span>
              {duration}
            </li>
          )}
        </ul>
      )}

      {earlier.length > 0 && (
        <details className="card-group" data-testid="card-group">
          <summary className="card-group-summary">
            {earlier.length === 1 ? "1 earlier update" : `${earlier.length} earlier updates`}
          </summary>
          <ol className="card-group-list" aria-label="Earlier updates, newest first">
            {earlier.map((e) => (
              <li key={e.id} className="card-group-item" data-item-id={e.id}>
                <a href={itemPath(e.id, window.location.search)} onClick={openHandler(e.id, onOpen)}>
                  {e.civic?.label || e.title || kindLabel(e.kind)}
                </a>
                <time dateTime={e.publishedAt} title={fullDateTime(e.publishedAt)}>
                  {relativeTime(e.publishedAt, now)}
                </time>
              </li>
            ))}
          </ol>
        </details>
      )}

      <footer className="card-footer">
        {host && (
          <span className="card-host" data-testid="card-host">
            {host}
          </span>
        )}
        <button
          type="button"
          className="card-action"
          onClick={() => (read ? onMarkUnread(item.id) : onMarkRead(item.id))}
          aria-describedby={item.title ? titleId : undefined}
        >
          {read ? "Mark unread" : "Mark read"}
        </button>
      </footer>
    </article>
  );
}
