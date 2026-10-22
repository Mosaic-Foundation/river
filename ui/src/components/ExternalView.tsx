// The embedded view (ui-revisions-2 item 2), after citizen-dashboard's ExternalView and
// BackSidebar: a narrow full-height bar with the Mosaic mark and "River" that returns to the
// River, and the rest of the window showing the item where it lives, in a sandboxed iframe. The
// frame may run its own scripts in its own origin, submit its forms and open links in new tabs,
// but never navigate the River's page (no allow-top-navigation); it gets no referrer.
import { useEffect, useRef, useState } from "react";
import { ExternalIcon } from "./Icons";

export interface ExternalViewProps {
  /** What the iframe loads: a Mastodon /embed page or a page the framing check allowed. */
  src: string;
  /** The item's own page, for "Open in new tab". */
  pageUrl: string;
  /** Names the frame for screen readers, e.g. "Post from EFF on mastodon.social". */
  title: string;
  host: string;
  onBack: () => void;
}

export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export function ExternalView({ src, pageUrl, title, host, onBack }: ExternalViewProps) {
  const [loading, setLoading] = useState(true);
  const backRef = useRef<HTMLButtonElement>(null);

  // Focus starts on the way back, so a keyboard or screen reader user knows where it is. While
  // the view is open the page has no scrollbar gutter, so the frame reaches the window's edge.
  useEffect(() => {
    backRef.current?.focus();
    document.documentElement.dataset.view = "external";
    return () => {
      delete document.documentElement.dataset.view;
    };
  }, []);

  return (
    <div className="external" data-testid="external-view">
      <nav className="external-bar" aria-label="River">
        <button type="button" className="external-back" ref={backRef} onClick={onBack} data-testid="external-back">
          <span className="external-mark">
            <img src="/favicon.svg" alt="" width="32" height="32" />
          </span>
          <span className="external-label">
            <span className="visually-hidden">Back to the </span>River
          </span>
        </button>
        <a className="external-open" href={pageUrl} target="_blank" rel="noopener noreferrer" title="Open in new tab">
          <ExternalIcon />
          <span className="visually-hidden">Open in new tab (on {host})</span>
        </a>
      </nav>
      <div className="external-frame">
        {loading && (
          <p className="external-loading" role="status">
            Loading {host}…
          </p>
        )}
        <iframe
          src={src}
          title={title}
          sandbox={FRAME_SANDBOX}
          referrerPolicy="no-referrer"
          allow=""
          onLoad={() => setLoading(false)}
          data-testid="external-frame"
        />
      </div>
    </div>
  );
}
