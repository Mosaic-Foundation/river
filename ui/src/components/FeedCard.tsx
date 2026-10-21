// One feed card (spec F1, F4, 4.8). Text is rendered as text; the item's contentHtml, already
// sanitized on the server by src/shared/sanitize/, is the only HTML (CLAUDE.md constraint 8).
import type { FeedItem } from "../lib/api";
import {
  deadlineLabel,
  eventDate,
  formatDuration,
  fullDateTime,
  kindLabel,
  linkHost,
  relativeTime,
} from "../lib/format";
import { CardMedia } from "./CardMedia";
import { BoostIcon, ExternalIcon } from "./Icons";
import { SourceIcon } from "./SourceIcon";

export interface FeedCardProps {
  item: FeedItem;
  read: boolean;
  now: number;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onSampleInfo: (trigger: HTMLButtonElement) => void;
}

/** Spec F4: links open in a new tab with rel="noopener noreferrer" (the sanitizer sets rel). */
function openLinksInNewTab(el: HTMLDivElement | null): void {
  el?.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    a.target = "_blank";
    a.rel = "nofollow noopener noreferrer";
  });
}

export function FeedCard({ item, read, now, onMarkRead, onMarkUnread, onSampleInfo }: FeedCardProps) {
  const titleId = `item-${item.id}-title`;
  const host = item.source === "live" ? linkHost(item.url) : undefined;
  const actor = item.author?.name || item.space.name;
  const duration = formatDuration(item.media.find((m) => m.duration)?.duration, item.kind);
  const event = eventDate(item.event?.startTime);
  const deadline = deadlineLabel(item.civic?.deadline);
  const civicLabel = item.kind === "civic" || item.civic ? item.civic?.label : undefined;
  const text = item.contentHtml ? undefined : item.summary;

  return (
    <article
      className={read ? "card" : "card card-unread"}
      aria-labelledby={item.title ? titleId : undefined}
      aria-label={item.title ? undefined : `${kindLabel(item.kind)} from ${item.space.name}`}
      data-testid="feed-card"
      data-source={item.source}
      data-kind={item.kind}
    >
      <header className="card-header">
        <SourceIcon name={item.space.name} iconUrl={item.space.iconUrl} />
        <div className="card-byline">
          <span className="card-source">{item.space.name}</span>
          <span className="card-meta">
            <span className="card-kind">{kindLabel(item.kind)}</span>
            <span aria-hidden="true"> · </span>
            <time dateTime={item.publishedAt} title={fullDateTime(item.publishedAt)}>
              {relativeTime(item.publishedAt, now)}
            </time>
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

      {item.boostOf && (
        <p className="card-boost">
          <BoostIcon />
          {actor} boosted a post from {item.boostOf.host}
        </p>
      )}

      {item.title && (
        <h2 className="card-title" id={titleId}>
          {item.title}
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
      {item.boostOf && !item.contentHtml && !text && (
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
          {civicLabel && <li className="chip-static">{civicLabel}</li>}
          {deadline && <li className="chip-static">{deadline}</li>}
          {item.isFinalResult && <li className="chip-static">Final result</li>}
          {duration && (
            <li className="chip-static">
              <span className="visually-hidden">Length: </span>
              {duration}
            </li>
          )}
        </ul>
      )}

      <footer className="card-footer">
        {host && item.url && (
          <a
            className="card-open"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onMarkRead(item.id)}
            onAuxClick={() => onMarkRead(item.id)}
          >
            Open on {host}
            <ExternalIcon />
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
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
