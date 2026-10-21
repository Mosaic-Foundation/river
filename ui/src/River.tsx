// The feed page at / (spec F1, F4, F5; §7 M6: Everything mode, desktop and phone). Visitors only
// until sign-in (M8): read state stays in this browser and the page makes no server write.
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadFeed, type FeedCircle, type FeedItem } from "./lib/api";
import { CONTENT_TYPES, SAMPLE_EXPLAINER } from "./lib/format";
import { browserStore, loadRead, markRead, markUnread, saveRead } from "./lib/readState";
import { Header, TabBar } from "./components/Chrome";
import { TAB_PLACEHOLDERS, type Tab } from "./lib/tabs";
import { FeedCard } from "./components/FeedCard";
import { FilterChips, FilterSidebar, SearchField, type FilterState } from "./components/Filters";
import { InfoDialog } from "./components/InfoDialog";
import { NotFound } from "./components/NotFound";

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

function useReadState() {
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
  const reads = useReadState();
  const now = useNow();

  useEffect(() => {
    filtersToUrl(filters);
    const controller = new AbortController();
    loadFeed({ circle: filters.circle, type: filters.type, q: filters.q }, controller.signal)
      .then((result) => {
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
        onFollow={(trigger) => setFollowTrigger(trigger)}
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
                onClick={() => reads.markRead(items.map((i) => i.id))}
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

        {tab !== "feed" && (
          <section className="tab-placeholder phone-only" aria-labelledby="tab-title">
            <h1 id="tab-title">{TAB_PLACEHOLDERS[tab].title}</h1>
            <p>{TAB_PLACEHOLDERS[tab].text}</p>
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
        <p>
          Following Civic Hubs and fediverse accounts comes with an account, and sign-up is coming soon. Until
          then you're reading this River's default follows.
        </p>
      </InfoDialog>
    </div>
  );
}
