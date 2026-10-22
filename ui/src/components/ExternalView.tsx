// The embedded view (ui-revisions-2 item 2), after citizen-dashboard's ExternalView and
// BackSidebar: a narrow full-height bar with the Mosaic mark and "River" that returns to the
// River, and the rest of the window showing the item where it lives, in a sandboxed iframe. The
// frame may run its own scripts in its own origin, submit its forms and open links in new tabs,
// but never navigate the River's page (no allow-top-navigation); it gets no referrer. With no
// page to frame (a fediverse post, a page that refuses framing, or one still being checked), the
// space beside the bar holds one button, "Open on {host} ↗", the original in a new tab
// (ui-revisions-3 item 2); if a pending check then allows framing, the frame replaces it.
import { useEffect, useRef, useState } from "react";
import { ExternalIcon } from "./Icons";

export interface ExternalViewProps {
  itemId: string;
  /** What the iframe loads: a page the framing check allowed. None: the "Open on {host}" screen. */
  src?: string;
  /** The framing check is still running. */
  checking?: boolean;
  /** Called when the original is opened in a new tab (it then counts as read). */
  onOpened?: () => void;
  /** The item's own page, for "Open in new tab". */
  pageUrl: string;
  /** Names the frame for screen readers, e.g. "Post from EFF on mastodon.social". */
  title: string;
  host: string;
  onBack: () => void;
}

export const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

export function ExternalView({ itemId, src, checking = false, onOpened, pageUrl, title, host, onBack }: ExternalViewProps) {
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
    <div className="external" data-testid="external-view" data-item-id={itemId}>
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
      {src ? (
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
      ) : (
        <section className="external-elsewhere" aria-labelledby="external-elsewhere-title" data-testid="external-elsewhere">
          <h1 className="external-elsewhere-title" id="external-elsewhere-title">
            {title}
          </h1>
          <a
            className="button button-primary"
            href={pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onOpened}
            data-testid="external-elsewhere-open"
          >
            Open on {host}
            <span aria-hidden="true"> ↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
          <p className="external-elsewhere-note" role="status">
            {checking ? `Checking whether ${host} can be shown here…` : `${host} opens in its own tab.`}
          </p>
        </section>
      )}
    </div>
  );
}
