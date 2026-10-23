// What a Bluesky post shows inside itself (ADR-009 item 4): a link card and a quoted post. Both
// arrive as plain text and https URLs (the server's readEmbed()), and are rendered as text here,
// never as HTML. Links open in a new tab with rel="noopener noreferrer" (spec F4); images load
// straight from the source, lazy, without a referrer, and are dropped if they fail (spec 4.8).
import { useState } from "react";
import type { ItemEmbed } from "../lib/api";
import { fullDateTime, linkHost, relativeTime, safeImageUrl } from "../lib/format";
import { CardMedia } from "./CardMedia";
import { SourceIcon } from "./SourceIcon";

/** Opening a link counts as reading the item (spec F4). */
type Opened = () => void;

function LinkCard({ link, onOpened }: { link: NonNullable<ItemEmbed["link"]>; onOpened: Opened }) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const host = linkHost(link.url);
  const thumb = thumbFailed ? undefined : safeImageUrl(link.thumb);
  if (!host) return null;
  return (
    <a
      className="card-link"
      data-testid="card-link"
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpened}
    >
      {thumb && (
        <img
          className="card-link-thumb"
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setThumbFailed(true)}
        />
      )}
      <span className="card-link-body">
        <span className="card-link-host">{host}</span>
        <span className="card-link-title">{link.title || link.url}</span>
        {link.description && <span className="card-link-description">{link.description}</span>}
        <span className="visually-hidden"> (opens in a new tab)</span>
      </span>
    </a>
  );
}

function QuotedPost({ quote, now, onOpened }: { quote: NonNullable<ItemEmbed["quote"]>; now: number; onOpened: Opened }) {
  if (quote.unavailable) {
    return (
      <p className="card-quote card-muted" data-testid="card-quote">
        The quoted post isn't available.
      </p>
    );
  }
  const name = quote.author?.name || quote.author?.handle || "A post";
  return (
    <blockquote className="card-quote" data-testid="card-quote" cite={quote.url}>
      <p className="card-quote-byline">
        <SourceIcon name={name} iconUrl={quote.author?.iconUrl ?? null} />
        <span className="card-quote-name">{name}</span>
        {quote.author?.handle && quote.author.handle !== name && (
          <span className="card-quote-handle">{quote.author.handle}</span>
        )}
        {quote.publishedAt && (
          <>
            <span aria-hidden="true"> · </span>
            <time dateTime={quote.publishedAt} title={fullDateTime(quote.publishedAt)}>
              {relativeTime(quote.publishedAt, now)}
            </time>
          </>
        )}
      </p>
      {quote.text && <p className="card-quote-text">{quote.text}</p>}
      {quote.media && quote.media.length > 0 && <CardMedia media={quote.media} limit={4} />}
      {quote.url && (
        <a className="card-quote-open" href={quote.url} target="_blank" rel="noopener noreferrer" onClick={onOpened}>
          Open quoted post<span aria-hidden="true"> ↗</span>
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
      )}
    </blockquote>
  );
}

export function PostEmbed({ embed, now, onOpened }: { embed: ItemEmbed; now: number; onOpened: Opened }) {
  return (
    <>
      {embed.quote && <QuotedPost quote={embed.quote} now={now} onOpened={onOpened} />}
      {embed.link && <LinkCard link={embed.link} onOpened={onOpened} />}
    </>
  );
}
