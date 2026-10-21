// A card's images (spec 4.8): straight from the source, lazy, no referrer, https only (or the
// River's own /samples/). No spinner; an image that fails to load is removed and the card renders
// without it (check 21). Alt text comes from the media.
import { useState } from "react";
import type { MediaRef } from "../lib/api";
import { cardImages, safeImageUrl } from "../lib/format";

export function CardMedia({ media }: { media: MediaRef[] }) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const images = cardImages(media).filter((m) => !failed.has(m.url));
  if (images.length === 0) return null;
  return (
    <div className={`card-media card-media-${Math.min(images.length, 4)}`} data-testid="card-media">
      {images.map((m) => (
        <figure className="card-media-item" key={m.url}>
          <img
            src={safeImageUrl(m.url)}
            alt={m.alt ?? ""}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            width={m.width}
            height={m.height}
            onError={() => setFailed((prev) => new Set(prev).add(m.url))}
          />
        </figure>
      ))}
    </div>
  );
}
