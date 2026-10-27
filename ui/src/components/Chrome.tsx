// The River's frame: the header (logo, the mode switch, phone search toggle, Sign in on desktop
// for a visitor, Follow, and the profile menu with My information, Following, Settings and Sign
// out, ui-revisions-9 and 11) and the phone's bottom tabs (spec 2, phone paragraph),
// plus the You panel. The mode switch shows the instance's modes
// and hides when there is only one (spec F9, check 8).
import { SIGN_IN_URL, viewerLabel, type ModeOption, type Viewer } from "../lib/api";
import { showModeSwitch } from "../lib/modes";
import type { Tab } from "../lib/tabs";
import { CirclesIcon, FeedIcon, FollowingIcon, PlusIcon, SearchIcon, YouIcon } from "./Icons";
import { ProfileMenu } from "./ProfileMenu";

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

/** Everything | Civic (spec F9): pressed buttons, one per mode the instance offers. */
export function ModeSwitch({
  modes,
  current,
  onChange,
}: {
  modes: readonly ModeOption[];
  current: string;
  onChange: (mode: string) => void;
}) {
  if (!showModeSwitch(modes)) return null;
  return (
    <div className="mode-switch" role="group" aria-label="Mode">
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          className="mode-option"
          aria-pressed={current === m.id}
          onClick={() => {
            if (current !== m.id) onChange(m.id);
          }}
        >
          {m.title}
        </button>
      ))}
    </div>
  );
}

export interface HeaderProps {
  /** The instance's modes and the current one; empty while the first feed loads. */
  modes: readonly ModeOption[];
  mode: string;
  onMode: (mode: string) => void;
  /** The Following page, keeping the mode (the profile menu's Following item; Follow goes there too). */
  followingHref: string;
  /** Your activity, keeping the mode. */
  activityHref: string;
  /** Settings → Linked accounts, keeping the mode. */
  linkedAccountsHref?: string;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onFollow: (trigger: HTMLButtonElement) => void;
  /** Undefined while the first feed loads; null for a visitor. */
  viewer: Viewer | null | undefined;
  /** `everywhere`: end every session of this account, on every device. */
  onSignOut: (everywhere?: boolean) => void;
  /** A title centred in the bar (Civic mode's "Citizen Dashboard", ui-revisions-5 item 2). */
  title?: string | null;
}

export function Header({ modes, mode, onMode, followingHref, activityHref, linkedAccountsHref, searchOpen, onToggleSearch, onFollow, viewer, onSignOut, title }: HeaderProps) {
  const switchShown = showModeSwitch(modes);
  return (
    <header className={["topbar", switchShown ? "topbar-modes" : "", title ? "topbar-titled" : ""].filter(Boolean).join(" ")}>
      <div className="topbar-start">
        <Brand />
        <ModeSwitch modes={modes} current={mode} onChange={onMode} />
      </div>
      {/* The page's h1 is in the feed (visually hidden), so this is text, not a second heading. */}
      {title && (
        <p className="topbar-title" data-testid="topbar-title">
          {title}
        </p>
      )}
      <div className="topbar-actions">
        {viewer === null && (
          <a className="button button-quiet desktop-inline" href={SIGN_IN_URL}>
            Sign in
          </a>
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
        {/* Who is signed in, their DID and Settings live in this menu, not the bar (ui-revisions-9). */}
        {viewer !== undefined && (
          <ProfileMenu
            viewer={viewer}
            onSignOut={onSignOut}
            followingHref={followingHref}
            activityHref={activityHref}
            linkedAccountsHref={linkedAccountsHref}
          />
        )}
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

/**
 * The You tab (phone): sign up or sign in, or who is signed in, Your activity (ADR-010 §7), Linked
 * accounts (fediverse-posting-1 item 1), Sign out
 * and Sign out everywhere (spec F2, F3, F10).
 */
export function YouPanel({
  viewer,
  onSignOut,
  activityHref = "/activity",
  linkedAccountsHref = "/linked-accounts",
}: {
  viewer: Viewer | null | undefined;
  onSignOut: (everywhere?: boolean) => void;
  /** Your activity (ADR-010 §7), keeping the mode. */
  activityHref?: string;
  /** Settings → Linked accounts, keeping the mode. */
  linkedAccountsHref?: string;
}) {
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
      <p>
        <a href={activityHref}>Your activity</a>: everything the River has sent in your name.
      </p>
      <p>
        <a href={linkedAccountsHref}>Linked accounts</a>: reply, boost and post as your Mastodon or GoToSocial account.
      </p>
      <p className="account-actions">
        <button type="button" className="button button-secondary" onClick={() => onSignOut()}>
          Sign out
        </button>
        <button type="button" className="button button-secondary" onClick={() => onSignOut(true)}>
          Sign out everywhere
        </button>
      </p>
      <p className="card-muted">
        Sign out everywhere ends your sessions on every device, this one included. Then check{" "}
        <a href={activityHref}>Your activity</a> for anything you didn't send.
      </p>
    </>
  );
}
