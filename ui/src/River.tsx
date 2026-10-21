// The feed page at / (spec F1, F4, F5, F10; §7 M6, M8: Everything mode, desktop and phone). A
// visitor's read state stays in this browser and the page makes no server write (check 23); a
// signed-in member's is saved to their account through the API and comes back with the feed. On a phone,
// members follow, unfollow and edit circles in the Following and Circles tabs (M9, spec F6-F8).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  loadFeed,
  saveAllRead,
  saveReadState,
  signOut,
  SIGN_IN_URL,
  type FeedCircle,
  type FeedItem,
  type Viewer,
} from "./lib/api";
import { CONTENT_TYPES, SAMPLE_EXPLAINER } from "./lib/format";
import { browserStore, loadRead, markRead, markUnread, saveRead } from "./lib/readState";
import { Header, TabBar, YouPanel } from "./components/Chrome";
import { TAB_PLACEHOLDERS, type Tab } from "./lib/tabs";
import { FeedCard } from "./components/FeedCard";
import { FilterChips, FilterSidebar, SearchField, type FilterState } from "./components/Filters";
import { InfoDialog } from "./components/InfoDialog";
import { NotFound } from "./components/NotFound";
import { CirclesPanel } from "./components/CirclesPanel";
import { FollowBox } from "./components/FollowBox";
import { FollowingList } from "./components/FollowingList";
import { useFollowing } from "./components/useFollowing";
import { SignUpPrompt } from "./Following";

/** The phone layout's media query (river.css: below 56rem). */
const PHONE_QUERY = "(max-width: 55.99rem)";

type Load =
  | { status: "loading" }
  | { status: "unknown_host"; message: string }
  | { status: "error"; message: string }
  | {
      status: "ok";
      items: FeedItem[];
      circles: FeedCircle[];
      mode: string;
      theme: string;
      nextCursor: string | null;
      emptyMessage: string | null;
      viewer: Viewer | null;
    };

const MODE_TITLES: Record<string, string> = { everything: "Everything", civic: "Civic" };

/** Filters from the address bar, so a reload or a shared link keeps them. */
function filtersFromUrl(): FilterState {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("type") ?? "all";
  return {
    circle: params.get("circle") || "All",
    type: CONTENT_TYPES.some((t) => t.value === type) ? type : "all",
    q: params.get("q") ?? "",
  };
}

function filtersToUrl(filters: FilterState): void {
  const params = new URLSearchParams();
  if (filters.circle !== "All") params.set("circle", filters.circle);
  if (filters.type !== "all") params.set("type", filters.type);
  if (filters.q) params.set("q", filters.q);
  const search = params.toString();
  window.history.replaceState(null, "", search ? `/?${search}` : "/");
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** A visitor's read state: this browser only, no server write (check 23). */
function useBrowserReadState() {
  const [read, setRead] = useState<string[]>(() => loadRead(browserStore()));
  const update = useCallback((next: (current: string[]) => string[]) => {
    setRead((current) => {
      const value = next(current);
      saveRead(browserStore(), value);
      return value;
    });
  }, []);
  const readSet = useMemo(() => new Set(read), [read]);
  return {
    isRead: (id: string) => readSet.has(id),
    markRead: (ids: string[]) => update((c) => markRead(c, ids)),
    markUnread: (ids: string[]) => update((c) => markUnread(c, ids)),
  };
}

/**
 * A member's read state: what the feed said, plus this page's changes, each saved through the API
 * at once. A change the server refuses is undone, so what shows is what a reload would show.
 */
function useServerReadState(items: FeedItem[]) {
  const [changes, setChanges] = useState<Map<string, boolean>>(() => new Map());
  const set = useCallback((ids: string[], value: boolean | undefined) => {
    setChanges((current) => {
      const next = new Map(current);
      for (const id of ids) {
        if (value === undefined) next.delete(id);
        else next.set(id, value);
      }
      return next;
    });
  }, []);
  const fromFeed = useMemo(() => new Map(items.map((i) => [i.id, i.read === true])), [items]);
  const change = (ids: string[], read: boolean) => {
    if (ids.length === 0) return;
    set(ids, read);
    void saveReadState(read ? { read: ids } : { unread: ids }).then((ok) => {
      if (!ok) set(ids, undefined);
    });
  };
  return {
    isRead: (id: string) => changes.get(id) ?? fromFeed.get(id) ?? false,
    markRead: (ids: string[]) => change(ids, true),
    markUnread: (ids: string[]) => change(ids, false),
    /** Marks the whole view read on the server, and the loaded items here. */
    markView: (ids: string[], query: FilterState) => {
      set(ids, true);
      void saveAllRead(query).then((ok) => {
        if (!ok) set(ids, undefined);
      });
    },
  };
}

export function River() {
  const [filters, setFilters] = useState<FilterState>(filtersFromUrl);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [tab, setTab] = useState<Tab>("feed");
  const [searchOpen, setSearchOpen] = useState(() => filtersFromUrl().q !== "");
  const [sampleTrigger, setSampleTrigger] = useState<HTMLElement | null>(null);
  const [followTrigger, setFollowTrigger] = useState<HTMLElement | null>(null);
  const browserReads = useBrowserReadState();
  const serverReads = useServerReadState(load.status === "ok" ? load.items : []);
  const viewer = load.status === "ok" ? load.viewer : undefined;
  const reads = viewer ? serverReads : browserReads;
  const now = useNow();
  // The phone's Following and Circles tabs (members): changes there reload the feed too.
  const reloadFeed = useCallback(() => setRetry((n) => n + 1), []);
  const following = useFollowing(Boolean(viewer) && (tab === "following" || tab === "circles"), reloadFeed);
  const reloadFollowing = following.reload;
  const afterFollow = useCallback(() => {
    reloadFollowing();
    reloadFeed();
  }, [reloadFollowing, reloadFeed]);

  useEffect(() => {
    filtersToUrl(filters);
    const controller = new AbortController();
    loadFeed({ circle: filters.circle, type: filters.type, q: filters.q }, controller.signal)
      .then((result) => {
        if (result.status === "bad_circle") {
          // A circle from another view (a visitor's circle name after sign-in): show All.
          setFilters((current) => ({ ...current, circle: "All" }));
          return;
        }
        if (result.status !== "ok") {
          setLoad(result);
          return;
        }
        const { feed } = result;
        setLoad({
          status: "ok",
          items: feed.items,
          circles: feed.circles,
          mode: feed.mode,
          theme: feed.mode === "civic" ? "civic" : "mosaic",
          nextCursor: feed.nextCursor,
          emptyMessage: feed.empty ? feed.emptyMessage : null,
          viewer: feed.viewer ?? null,
        });
      })
      .catch(() => {
        // Aborted: a newer filter replaced this request.
      });
    return () => controller.abort();
  }, [filters, retry]);

  // Everything mode uses the Mosaic theme (spec 4.7); Civic mode's switch arrives in M10.
  const theme = load.status === "ok" ? load.theme : "mosaic";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const mode = load.status === "ok" ? load.mode : "everything";
  useEffect(() => {
    if (load.status !== "unknown_host") document.title = `${MODE_TITLES[mode] ?? "River"} · Mosaic River`;
  }, [mode, load.status]);

  const setFilter = (patch: Partial<FilterState>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setMoreError(null);
    setLoad((current) => (current.status === "ok" ? current : { status: "loading" }));
  };

  const loadMore = async () => {
    if (load.status !== "ok" || !load.nextCursor || moreLoading) return;
    setMoreLoading(true);
    setMoreError(null);
    const cursor = load.nextCursor;
    const result = await loadFeed({ ...filters, cursor }).catch(() => undefined);
    setMoreLoading(false);
    if (!result || result.status !== "ok") {
      setMoreError("More items couldn't load. Try again.");
      return;
    }
    setLoad((current) => {
      if (current.status !== "ok" || current.nextCursor !== cursor) return current;
      const seen = new Set(current.items.map((i) => i.id));
      return {
        ...current,
        items: [...current.items, ...result.feed.items.filter((i) => !seen.has(i.id))],
        nextCursor: result.feed.nextCursor,
      };
    });
  };

  const endSession = () => {
    void signOut().then(() => window.location.assign("/"));
  };

  if (load.status === "unknown_host") return <NotFound message={load.message} homeLink={false} />;

  const circles = load.status === "ok" ? load.circles : [];
  const items = load.status === "ok" ? load.items : [];
  const unread = items.filter((i) => !reads.isRead(i.id));
  const filterProps = {
    circles,
    value: filters,
    onCircle: (circle: string) => setFilter({ circle }),
    onType: (type: string) => setFilter({ type }),
    onSearch: (q: string) => setFilter({ q: q.trim() }),
  };

  return (
    <div className="page">
      <a className="skip-link" href="#feed">
        Skip to the feed
      </a>
      <Header
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((open) => !open)}
        onFollow={(trigger) => {
          // Visitors: the sign-up note. Members: the follow box (the phone's Following tab, or the
          // Following page on a desktop).
          if (!viewer) setFollowTrigger(trigger);
          else if (window.matchMedia(PHONE_QUERY).matches) {
            setTab("following");
            window.setTimeout(() => document.getElementById("follow-input-phone")?.focus(), 0);
          } else window.location.assign("/following#follow");
        }}
        viewer={viewer}
        onSignOut={endSession}
      />
      {searchOpen && (
        <div className="phone-search phone-only" id="phone-search">
          <SearchField id="search-phone" value={filters.q} onSearch={filterProps.onSearch} />
        </div>
      )}
      <div className={tab === "feed" ? "phone-only" : "phone-only hidden"}>
        <FilterChips {...filterProps} />
      </div>

      <div className="layout">
        <div className="desktop-only">
          <FilterSidebar {...filterProps} />
        </div>

        <main className={tab === "feed" ? "feed" : "feed hidden-phone"} id="feed" tabIndex={-1}>
          <div className="feed-head">
            <h1 className="feed-title">
              {MODE_TITLES[mode] ?? "River"}
            </h1>
            <p className="feed-summary">
              {load.status === "ok" && items.length > 0 ? `${unread.length} unread · newest first` : "Newest first"}
            </p>
            {load.status === "ok" && items.length > 0 && (
              <button
                type="button"
                className="button button-quiet"
                disabled={unread.length === 0}
                onClick={() =>
                  viewer
                    ? serverReads.markView(items.map((i) => i.id), filters)
                    : browserReads.markRead(items.map((i) => i.id))
                }
              >
                Mark all read
              </button>
            )}
          </div>

          {load.status === "loading" && (
            <p className="feed-status" role="status">
              Loading your River…
            </p>
          )}
          {load.status === "error" && (
            <div className="feed-status" role="alert">
              <p>{load.message}</p>
              <button type="button" className="button button-primary" onClick={() => setRetry((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {load.status === "ok" && load.emptyMessage && (
            <p className="feed-status feed-empty" role="status">
              {load.emptyMessage}
            </p>
          )}

          {items.length > 0 && (
            <ol className="feed-list" aria-label="Items, newest first">
              {items.map((item) => (
                <li key={item.id}>
                  <FeedCard
                    item={item}
                    read={reads.isRead(item.id)}
                    now={now}
                    onMarkRead={(id) => reads.markRead([id])}
                    onMarkUnread={(id) => reads.markUnread([id])}
                    onSampleInfo={(trigger) => setSampleTrigger(trigger)}
                  />
                </li>
              ))}
            </ol>
          )}

          {load.status === "ok" && load.nextCursor && (
            <div className="feed-more">
              <button type="button" className="button button-secondary" onClick={loadMore} disabled={moreLoading}>
                {moreLoading ? "Loading more…" : "Load more"}
              </button>
              {moreError && <p role="alert">{moreError}</p>}
            </div>
          )}
        </main>

        {tab === "you" && (
          <section className="tab-placeholder phone-only" aria-labelledby="tab-title">
            <h1 id="tab-title">You</h1>
            <YouPanel viewer={viewer} onSignOut={endSession} />
          </section>
        )}
        {(tab === "following" || tab === "circles") && (
          <section className="tab-placeholder phone-only" aria-labelledby="tab-title">
            <h1 id="tab-title">{TAB_PLACEHOLDERS[tab].title}</h1>
            {viewer === null && <SignUpPrompt text={TAB_PLACEHOLDERS[tab].text} />}
            {viewer && following.state.status === "loading" && (
              <p className="feed-status" role="status">
                Loading what you follow…
              </p>
            )}
            {viewer && following.state.status === "error" && (
              <div className="feed-status" role="alert">
                <p>{following.state.message}</p>
                <button type="button" className="button button-primary" onClick={following.reload}>
                  Try again
                </button>
              </div>
            )}
            {viewer && following.state.status === "ok" && tab === "following" && (
              <>
                <FollowBox circles={following.state.page.circles} onFollowed={afterFollow} inputId="follow-input-phone" />
                <FollowingList page={following.state.page} run={following.run} busy={following.busy} />
              </>
            )}
            {viewer && following.state.status === "ok" && tab === "circles" && (
              <CirclesPanel page={following.state.page} run={following.run} busy={following.busy} />
            )}
          </section>
        )}
      </div>

      <TabBar active={tab} onChange={setTab} />

      <InfoDialog
        trigger={sampleTrigger}
        title="Sample entry"
        onClose={() => setSampleTrigger(null)}
        testId="sample-dialog"
      >
        <p>{SAMPLE_EXPLAINER}</p>
      </InfoDialog>
      <InfoDialog
        trigger={followTrigger}
        title="Follow a Space"
        onClose={() => setFollowTrigger(null)}
        testId="follow-dialog"
      >
        {/* Visitors only: members get the follow box. */}
        <p>
          Following Civic Hubs and fediverse accounts comes with an account. Until then you're reading this River's
          default follows.
        </p>
        <p>
          <a className="button button-primary" href={SIGN_IN_URL}>
            Sign up
          </a>
        </p>
      </InfoDialog>
    </div>
  );
}
