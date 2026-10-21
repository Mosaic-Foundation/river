// A card's source icon (spec F1): the space's avatar, or its initials. An avatar that fails to
// load falls back to initials (spec 4.8: no broken-image icon).
import { useState } from "react";
import { initials, safeImageUrl } from "../lib/format";

export function SourceIcon({ name, iconUrl }: { name: string; iconUrl: string | null }) {
  const [failed, setFailed] = useState(false);
  const src = safeImageUrl(iconUrl);
  if (src && !failed) {
    return (
      <img
        className="source-icon"
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        decoding="async"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="source-icon source-icon-initials" aria-hidden="true">
      {initials(name)}
    </span>
  );
}
