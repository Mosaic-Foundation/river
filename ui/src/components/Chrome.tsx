// The River's frame: the header (logo, phone search toggle, Follow) and the phone's bottom tabs
// (spec 2, phone paragraph). The mode picker arrives with modes (M10).
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
}

export function Header({ searchOpen, onToggleSearch, onFollow }: HeaderProps) {
  return (
    <header className="topbar">
      <Brand />
      <div className="topbar-actions">
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
