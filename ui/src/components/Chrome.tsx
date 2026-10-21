// The River's frame: the header (logo, phone search toggle, sign-in or the member's name and Sign
// out on desktop, Follow) and the phone's bottom tabs (spec 2, phone paragraph), plus the You
// panel. The mode picker arrives with modes (M10).
import { SIGN_IN_URL, viewerLabel, type Viewer } from "../lib/api";
import type { Tab } from "../lib/tabs";
import { CirclesIcon, FeedIcon, FollowingIcon, PlusIcon, SearchIcon, YouIcon } from "./Icons";

export function Brand({ link = true }: { link?: boolean }) {
  const parts = (
    <>
      <img className="brand-mark" src="/favicon.svg" alt="" width="28" height="28" />
      <span className="brand-name">Mosaic</span>
      <span className="brand-product">River</span>
    </>
  );
  return link ? (
    <a className="brand" href="/">
      {parts}
    </a>
  ) : (
    <span className="brand">{parts}</span>
  );
}

export interface HeaderProps {
  searchOpen: boolean;
  onToggleSearch: () => void;
  onFollow: (trigger: HTMLButtonElement) => void;
  /** Undefined while the first feed loads; null for a visitor. */
  viewer: Viewer | null | undefined;
  onSignOut: () => void;
}

export function Header({ searchOpen, onToggleSearch, onFollow, viewer, onSignOut }: HeaderProps) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-actions">
        {viewer === null && (
          <a className="button button-quiet desktop-inline" href={SIGN_IN_URL}>
            Sign in
          </a>
        )}
        {viewer && (
          <div className="account desktop-inline">
            <span className="account-name" title={viewer.did ?? undefined}>
              {viewerLabel(viewer)}
            </span>
            <button type="button" className="button button-quiet" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          className="icon-button phone-only"
          aria-label="Search"
          aria-expanded={searchOpen}
          aria-controls="phone-search"
          onClick={onToggleSearch}
        >
          <SearchIcon />
        </button>
        <button
          type="button"
          className="button button-primary follow-button"
          aria-haspopup="dialog"
          onClick={(e) => onFollow(e.currentTarget)}
        >
          <PlusIcon />
          <span className="follow-label">Follow</span>
        </button>
      </div>
    </header>
  );
}

const TABS: Array<{ id: Tab; label: string; Icon: (p: { className?: string }) => React.ReactElement }> = [
  { id: "feed", label: "Feed", Icon: FeedIcon },
  { id: "circles", label: "Circles", Icon: CirclesIcon },
  { id: "following", label: "Following", Icon: FollowingIcon },
  { id: "you", label: "You", Icon: YouIcon },
];

export function TabBar({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  return (
    <nav className="tabbar" aria-label="River sections">
      <ul className="tabbar-list">
        {TABS.map(({ id, label, Icon }) => (
          <li key={id}>
            <button
              type="button"
              className="tabbar-tab"
              aria-current={active === id ? "page" : undefined}
              onClick={() => onChange(id)}
            >
              <Icon className="tabbar-icon" />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The You tab (phone): sign up or sign in, or who is signed in and Sign out (spec F2, F3, F10). */
export function YouPanel({ viewer, onSignOut }: { viewer: Viewer | null | undefined; onSignOut: () => void }) {
  if (viewer === undefined) return null;
  if (viewer === null) {
    return (
      <>
        <p>
          Sign up to keep your follows, circles and read marks with you. You get a Mosaic ID with a passkey; no
          password.
        </p>
        <p className="account-actions">
          <a className="button button-primary" href={SIGN_IN_URL}>
            Sign up
          </a>
          <a className="button button-secondary" href={SIGN_IN_URL}>
            Sign in
          </a>
        </p>
        <p className="card-muted">Until then, what you mark read stays in this browser only.</p>
      </>
    );
  }
  return (
    <>
      <p>Signed in as</p>
      <p className="account-id">{viewerLabel(viewer)}</p>
      <p className="card-muted">What you mark read is saved to your account.</p>
      <p className="account-actions">
        <button type="button" className="button button-secondary" onClick={onSignOut}>
          Sign out
        </button>
      </p>
    </>
  );
}
