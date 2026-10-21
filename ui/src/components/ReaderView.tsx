// The reader view (ui-revisions-1 item 1): one stored item inside the River, at /item/{id}, with
// the left sidebar still beside it. Full sanitized content (src/shared/sanitize/, the only HTML;
// CLAUDE.md constraint 8), every image, the author and the source. "Back to River" returns to
// the feed where it was; "Open original" opens the item where it lives, in a new tab. Nothing is
// fetched from outside: the item comes from the loaded feed or GET /api/items/{id}. Audio and
// video from https sources play here, straight from the source, and load only when played
// (preload="none"; CSP media-src 'self' https:).
import { useEffect, useRef } from "react";
import type { FeedItem } from "../lib/api";
import {
  deadlineLabel,
  eventDate,
  formatDuration,
  fullDateTime,
  kindLabel,
  linkHost,
  playableMedia,
  safeMediaUrl,
} from "../lib/format";
import { CardMedia } from "./CardMedia";
import { BoostIcon, ExternalIcon } from "./Icons";
import { SourceIcon } from "./SourceIcon";

export type ReaderState = { status: "loading" } | { status: "not_found" } | { status: "error" } | { status: "ok"; item: FeedItem };

export interface ReaderViewProps {
  state: ReaderState;
  read: boolean;
  onBack: () => void;
  onMarkRead: (id: string) => void;
  onMarkUnread: (id: string) => void;
  onSampleInfo: (trigger: HTMLButtonElement) => void;
}

/** Spec F4: links open in a new tab with rel="noopener noreferrer". */
function openLinksInNewTab(el: HTMLDivElement | null): void {
  el?.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
    a.target = "_blank";
    a.rel = "nofollow noopener noreferrer";
  });
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="button button-secondary reader-back" onClick={onBack}>
      <span aria-hidden="true">←</span> Back to River
    </button>
  );
}

export function ReaderView({ state, read, onBack, onMarkRead, onMarkUnread, onSampleInfo }: ReaderViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const itemId = state.status === "ok" ? state.item.id : null;
  // Focus moves to the item's heading when it opens, so a screen reader starts there.
  useEffect(() => {
    if (itemId) headingRef.current?.focus();
  }, [itemId]);

  if (state.status !== "ok") {
    return (
      <section className="reader" aria-label="Reader" data-testid="reader">
        <BackButton onBack={onBack} />
        <p className="feed-status" role={state.status === "loading" ? "status" : "alert"}>
          {state.status === "loading" && "Loading this item…"}
          {state.status === "not_found" && "This item isn't in your River. It may have been removed."}
          {state.status === "error" && "This item couldn't load right now. Try again in a moment."}
        </p>
      </section>
    );
  }

  const { item } = state;
  const host = item.source === "live" ? linkHost(item.url) : undefined;
  const author = item.author;
  const authorHost = linkHost(author?.url);
  const event = eventDate(item.event?.startTime);
  const deadline = deadlineLabel(item.civic?.deadline);
  const duration = formatDuration(item.media.find((m) => m.duration)?.duration, item.kind);
  const civicLabel = item.kind === "civic" || item.civic ? item.civic?.label : undefined;
  const heading = item.title || `${kindLabel(item.kind)} from ${item.space.name}`;
  const players = playableMedia(item.media);
  // Media the reader can't play here (not https) still says where it plays.
  const elsewhere = players.length === 0 && item.media.some((m) => m.type === "audio" || m.type === "video");

  return (
    <article className="reader" aria-labelledby="reader-title" data-testid="reader" data-item-id={item.id}>
      <BackButton onBack={onBack} />

      <header className="reader-header">
        <SourceIcon name={item.space.name} iconUrl={item.space.iconUrl} />
        <div className="card-byline">
          <span className="card-source" data-testid="reader-source">
            {item.space.name}
          </span>
          <span className="card-meta">
            <span className="card-kind">{kindLabel(item.kind)}</span>
            <span aria-hidden="true"> · </span>
            <time dateTime={item.publishedAt}>{fullDateTime(item.publishedAt)}</time>
            {host && (
              <>
                <span aria-hidden="true"> · </span>
                <span>{host}</span>
              </>
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
        </div>
      </header>

      <h1 className="reader-title" id="reader-title" ref={headingRef} tabIndex={-1}>
        {heading}
      </h1>

      {author?.name && (
        <p className="reader-author" data-testid="reader-author">
          By {author.name}
          {author.handle && <span className="card-muted"> {author.handle}</span>}
          {!author.handle && authorHost && authorHost !== host && <span className="card-muted"> · {authorHost}</span>}
        </p>
      )}

      {item.boostOf && (
        <p className="card-boost">
          <BoostIcon />
          {author?.name || item.space.name} boosted a post from {item.boostOf.host}
        </p>
      )}

      {item.contentHtml && (
        // Sanitized server-side (Appendix B allowlist); nothing else uses this.
        <div
          className="reader-content card-html"
          ref={openLinksInNewTab}
          dangerouslySetInnerHTML={{ __html: item.contentHtml }}
        />
      )}
      {item.summary && (!item.contentHtml || item.kind === "civic") && <p className="reader-content">{item.summary}</p>}

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

      <CardMedia media={item.media} limit={20} />
      {players.map((m, i) => {
        const label = `${m.type === "video" ? "Video" : "Audio"}${players.length > 1 ? ` ${i + 1}` : ""} from ${linkHost(m.url) ?? item.space.name}`;
        return m.type === "video" ? (
          <video
            key={m.url}
            className="reader-media reader-video"
            src={safeMediaUrl(m.url)}
            controls
            preload="none"
            playsInline
            width={m.width}
            height={m.height}
            aria-label={m.alt ? `${label}: ${m.alt}` : label}
            data-testid="reader-player"
          />
        ) : (
          <audio
            key={m.url}
            className="reader-media reader-audio"
            src={safeMediaUrl(m.url)}
            controls
            preload="none"
            aria-label={m.alt ? `${label}: ${m.alt}` : label}
            data-testid="reader-player"
          />
        );
      })}
      {elsewhere && host && <p className="card-muted">This {kindLabel(item.kind).toLowerCase()} plays on {host}.</p>}

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

      <footer className="reader-footer">
        {host && item.url && (
          <a className="button button-primary" href={item.url} target="_blank" rel="noopener noreferrer">
            Open original
            <ExternalIcon />
            <span className="visually-hidden"> on {host} (opens in a new tab)</span>
          </a>
        )}
        <button
          type="button"
          className="button button-quiet"
          onClick={() => (read ? onMarkUnread(item.id) : onMarkRead(item.id))}
        >
          {read ? "Mark unread" : "Mark read"}
        </button>
      </footer>
    </article>
  );
}
