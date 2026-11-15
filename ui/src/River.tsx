// The feed page at / (spec F1, F4, F5, F9, F10; §7 M6, M8, M10: modes, desktop and phone). A
// visitor's read state stays in this browser and the page makes no server write (check 23); a
// signed-in member's is saved to their account through the API and comes back with the feed. On a phone,
// members follow, unfollow and edit circles in the Following and Circles tabs (M9, spec F6-F8).
// The mode (`?mode=`, else the instance's default) sets the scope, the theme and the plugin panel,
// all as the API answers them (M10, spec 4.7).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  loadFeed,
  loadItem,
  saveReadState,
  signOut,
  SIGN_IN_URL,
  type FeedCircle,
  type FeedSource,
  type FeedItem,
  type ModeOption,
  type SurfaceOutput,
  type Viewer,
} from "./lib/api";
import { modeFromSearch, topbarTitle, viewTitle, withMode } from "./lib/modes";
import { PluginPanel } from "./components/PluginPanel";
import { CONTENT_TYPES, kindLabel, linkHost, NETWORKS, parseList, SAMPLE_EXPLAINER, toggleValue } from "./lib/format";
import { browserStore, loadRead, markRead, markUnread, saveRead } from "./lib/readState";
import { Header, TabBar, YouPanel } from "./components/Chrome";
import { TAB_PLACEHOLDERS, type Tab } from "./lib/tabs";
import { FeedCard } from "./components/FeedCard";
import { FilterButton, FilterSheet, FilterSidebar, SearchField, type FilterState } from "./components/Filters";
import { CLEARED, toggleCircle } from "./lib/filters";
import { Composer } from "./components/Composer";
import { loadLinkedAccounts } from "./lib/linkedAccounts";
import { InfoDialog } from "./components/InfoDialog";
import { NotFound } from "./components/NotFound";
import { CirclesPanel } from "./components/CirclesPanel";
import { FollowBox } from "./components/FollowBox";
import { FollowingList } from "./components/FollowingList";
import { useFollowing } from "./components/useFollowing";
import { ReaderView, type ReaderState } from "./components/ReaderView";
import { ExternalView } from "./components/ExternalView";
import { boostedPost } from "./lib/boost";
import { cardOpen, framePlan, isHttpsUrl } from "./lib/embed";
import { useFrameAnswers, useVisibleFrameChecks } from "./lib/useFrameAnswers";
import { itemIdFromPath, itemPath } from "./lib/reader";
import { groupIds, groupItems } from "./lib/groups";
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
      /** The mode's sources for the Source filter (ui-revisions-11 item 2). */
      sources: FeedSource[];
      mode: string;
      modes: ModeOption[];
      defaultMode: string;
      theme: string;
      /** The river.panel surface's plugins, from the first page. */
      panel: SurfaceOutput[];
      nextCursor: string | null;
      emptyMessage: string | null;
      viewer: Viewer | null;
    };

/** The circles Civic mode lists: the one whose role is civic (found by role, never by name). */
function civicCircles(circles: FeedCircle[]): FeedCircle[] {
  return circles.filter((c) => c.role === "civic");
}

const MODE_TITLES: Record<string, string> = { everything: "Everything", civic: "Civic" };

/** Filters from the address bar, so a reload or a shared link keeps them. */
function filtersFromUrl(): FilterState {
  const params = new URLSearchParams(window.location.search);
  return {
    mode: modeFromSearch(window.location.search),
    // One `circle` per circle (ui-revisions-4 item 1); "All" or an empty one means every circle.
    circles: [...new Set(params.getAll("circle").filter((c) => c !== "" && c.toLowerCase() !== "all"))],
    types: parseList(params.get("type"), CONTENT_TYPES),
    networks: parseList(params.get("network"), NETWORKS),
    q: params.get("q") ?? "",
    source: params.get("source") ?? "",
  };
}

function filtersToUrl(filters: FilterState): void {
  const params = new URLSearchParams();
  if (filters.mode) params.set("mode", filters.mode);
  for (const circle of filters.circles) params.append("circle", circle);
  if (filters.types.length > 0) params.set("type", filters.types.join(","));
  if (filters.networks.length > 0) params.set("network", filters.networks.join(","));
  if (filters.q) params.set("q", filters.q);
  if (filters.source) params.set("source", filters.source);
  const search = params.toString();
  // The reader view keeps its /item/{id} path; the query string still carries the filters.
  const path = itemIdFromPath(window.location.pathname) ? window.location.pathname : "/";
  window.history.replaceState(window.history.state, "", search ? `${path}?${search}` : path);
}

/** Whether this history entry is the one the phone's filter sheet added (ui-revisions-6). */
function onSheetEntry(): boolean {
  return Boolean((window.history.state as { riverSheet?: boolean } | null)?.riverSheet);
}

function clearSheetEntry(): void {
  const state = { ...(window.history.state as Record<string, unknown>) };
  delete state.riverSheet;
  window.history.replaceState(state, "");
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
  // The composer (fediverse-posting-1 item 3): what opened it, and the item a reply answers.
  const [compose, setCompose] = useState<{ trigger: HTMLElement; replyTo: string | null; key: number } | null>(null);
  // The reader view (ui-revisions-1 item 1): the item in the address bar, and where the feed was.
  const [readerId, setReaderId] = useState<string | null>(() => itemIdFromPath(window.location.pathname));
  const [fetchedItem, setFetchedItem] = useState<{ id: string; state: ReaderState } | null>(null);
  // The framing check's answers this visit (ui-revisions-3 item 2): the URL to frame, or null.
  const frames = useFrameAnswers();
  const feedScroll = useRef<{ y: number; id: string } | null>(null);
  const browserReads = useBrowserReadState();
  const serverReads = useServerReadState(load.status === "ok" ? load.items : []);
  const viewer = load.status === "ok" ? load.viewer : undefined;
  // Members with a linked fediverse account get Post and Reply (item 2).
  const [linked, setLinked] = useState(false);
  const hasLink = Boolean(viewer) && linked;
  useEffect(() => {
    if (!viewer) return;
    const controller = new AbortController();
    loadLinkedAccounts(controller.signal).then(
      (result) => setLinked(result.status === "ok" && result.accounts.some((a) => a.status === "active")),
      () => undefined,
    );
    return () => controller.abort();
  }, [viewer]);
  const startPost = hasLink ? (trigger: HTMLElement) => setCompose({ trigger, replyTo: null, key: Date.now() }) : undefined;
  const reads = viewer ? serverReads : browserReads;
  const now = useNow();

  // The browser's Back and Forward move between the feed and the reader.
  // The phone's filter sheet (ui-revisions-6): opening it adds a history entry, so the back
  // gesture closes it; every other way of closing steps back over that entry.
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTrigger = useRef<HTMLButtonElement | null>(null);
  const filtersNow = useRef(filters);
  useEffect(() => {
    filtersNow.current = filters;
  }, [filters]);
  const openSheet = (trigger: HTMLButtonElement) => {
    sheetTrigger.current = trigger;
    window.history.pushState({ riverSheet: true }, "", window.location.href);
    setSheetOpen(true);
  };
  const sheetClosed = () => {
    setSheetOpen(false);
    // Back to the button, unless it's hidden (the window grew to desktop width).
    if (sheetTrigger.current?.checkVisibility()) sheetTrigger.current.focus();
    if (onSheetEntry()) window.history.back();
  };
  useEffect(() => {
    // A reload while the sheet was open lands on its entry with the sheet closed: unmark it.
    if (onSheetEntry()) clearSheetEntry();
  }, []);
  useEffect(() => {
    // The sheet is for phones: a window that grows to desktop width closes it.
    const query = window.matchMedia(PHONE_QUERY);
    const onChange = () => {
      if (!query.matches) setSheetOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onPop = () => {
      setReaderId(itemIdFromPath(window.location.pathname));
      // Back from the sheet's entry closes it. Filters live in this page, not in history, so the
      // entry Back lands on takes the current ones (the sheet may have changed them).
      setSheetOpen(false);
      // Forward onto the sheet's old entry leaves the sheet closed; unmark it so the next close
      // doesn't step back twice.
      if (onSheetEntry()) clearSheetEntry();
      filtersToUrl(filtersNow.current);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loadedItem = readerId && load.status === "ok" ? load.items.find((i) => i.id === readerId) : undefined;
  const readerState: ReaderState | null = !readerId
    ? null
    : loadedItem
      ? { status: "ok", item: loadedItem }
      : fetchedItem?.id === readerId
        ? fetchedItem.state
        : { status: "loading" };
  const needsFetch = Boolean(readerId) && !loadedItem && load.status !== "loading";

  // An item that isn't in the loaded feed (a shared or reloaded /item/{id}) comes from the API.
  useEffect(() => {
    if (!readerId || !needsFetch) return;
    const controller = new AbortController();
    loadItem(readerId, controller.signal)
      .then((result) => setFetchedItem({ id: readerId, state: result }))
      .catch(() => {
        // Aborted: another item replaced this one.
      });
    return () => controller.abort();
  }, [readerId, needsFetch]);

  // Opening an item marks it read, once the feed says whose read state it is (visitor or member).
  const readerItem = readerState?.status === "ok" ? readerState.item : undefined;
  const markedId = useRef<string | null>(null);
  const viewerKnown = load.status === "ok";
  useEffect(() => {
    if (!readerItem || !viewerKnown || markedId.current === readerItem.id) return;
    markedId.current = readerItem.id;
    if (!reads.isRead(readerItem.id)) reads.markRead([readerItem.id]);
  }, [readerItem, viewerKnown, reads]);

  // How the opened item shows (ui-revisions-3 item 2): framed beside the River bar when the
  // server's check allows it; otherwise the same bar with "Open on {host} ↗" (a page that refuses
  // framing, or one still being checked). A post that stays in the feed (fediverse, Bluesky) and an
  // item without a live page (a sample) show the reader at their own address, so a Bluesky post's
  // link card and quote show there too.
  const plan = readerItem ? framePlan(readerItem) : null;
  const checked = readerItem ? frames.answers[readerItem.id] : undefined;
  const checking = plan?.kind === "check" && checked === undefined;
  const requestFrame = frames.request;
  useEffect(() => {
    if (checking && readerItem) requestFrame(readerItem.id, true);
  }, [checking, readerItem, requestFrame]);
  const external = plan?.kind === "check";
  const frameSrc = plan?.kind === "check" && isHttpsUrl(checked) ? checked : undefined;
  const readerHost = readerItem ? linkHost(readerItem.url) : undefined;
  const shownReaderState: ReaderState | null = external ? null : readerState;

  // Back on the feed: the same scroll position, and focus on the card that was opened.
  useLayoutEffect(() => {
    if (readerId) {
      window.scrollTo(0, 0);
      return;
    }
    const from = feedScroll.current;
    if (!from) return;
    feedScroll.current = null;
    window.scrollTo(0, from.y);
    document
      .querySelector<HTMLElement>(`[data-item-id="${from.id}"] :is(.card-title-link, .card-permalink)`)
      ?.focus({ preventScroll: true });
  }, [readerId]);

  const openItem = (id: string) => {
    feedScroll.current = { y: window.scrollY, id };
    markedId.current = null;
    setTab("feed");
    window.history.pushState({ riverReader: true }, "", itemPath(id, window.location.search));
    setReaderId(id);
  };

  const closeReader = () => {
    // Opened from the feed: step back, so Forward reopens it. Opened directly: go to the feed.
    if ((window.history.state as { riverReader?: boolean } | null)?.riverReader) {
      window.history.back();
      return;
    }
    window.history.pushState(null, "", `/${window.location.search}`);
    setReaderId(null);
  };
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
    loadFeed(
      {
        mode: filters.mode,
        circles: filters.circles,
        types: filters.types,
        networks: filters.networks,
        q: filters.q,
        source: filters.source,
      },
      controller.signal,
    )
      .then((result) => {
        if (result.status === "bad_circle") {
          // A circle from another view (a visitor's circle name after sign-in): show All.
          setFilters((current) => ({ ...current, circles: [] }));
          return;
        }
        if (result.status === "bad_mode") {
          // A mode this River doesn't offer (an old link): open its default mode.
          setFilters((current) => ({ ...current, mode: "" }));
          return;
        }
        if (result.status === "bad_source") {
          // Not a source id (an edited link): every source.
          setFilters((current) => ({ ...current, source: "" }));
          return;
        }
        if (result.status !== "ok") {
          setLoad(result);
          return;
        }
        const { feed } = result;
        const sources = feed.sources ?? [];
        if (filters.source && feed.sources && !sources.some((s) => s.id === filters.source)) {
          // A source this mode doesn't read (Civic after Everything, or an unfollowed one): every source.
          setFilters((current) => ({ ...current, source: "" }));
          return;
        }
        setLoad({
          status: "ok",
          items: feed.items,
          circles: feed.circles,
          sources,
          mode: feed.mode,
          modes: feed.modes ?? [],
          defaultMode: feed.instance.defaultMode,
          theme: feed.theme ?? "mosaic",
          panel: feed.surfaces?.["river.panel"] ?? [],
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

  // The mode's theme, as the API names it (spec 4.7: Everything is Mosaic, Civic is Civic).
  const theme = load.status === "ok" ? load.theme : "mosaic";
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // The chosen mode shows as pressed at once; the title, theme and panel follow the feed the API
  // answered for it.
  const chosenMode = load.status === "ok" ? filters.mode || load.defaultMode : filters.mode || "everything";
  const mode = load.status === "ok" ? load.mode : chosenMode;
  const modes = load.status === "ok" ? load.modes : [];
  const modeTitle = modes.find((m) => m.id === mode)?.title ?? MODE_TITLES[mode] ?? "River";
  // Civic mode is the Citizen Dashboard (ui-revisions-5 item 2).
  const pageTitle = viewTitle(mode, modeTitle);
  // Links to the Following page keep a mode other than Everything (its theme follows).
  const linkMode = mode === "everything" ? "" : mode;
  const circles = load.status === "ok" ? load.circles : [];
  // Civic mode shows only civic sources, so only the role = civic circle (ui-revisions-1 item 5).
  const shownCircles = mode === "civic" ? civicCircles(circles) : circles;
  const readerTitle = readerItem ? readerItem.title || readerItem.space.name : null;
  useEffect(() => {
    if (load.status === "unknown_host") return;
    document.title = `${readerTitle ? `${readerTitle} · ` : ""}${pageTitle} · Mosaic River`;
  }, [pageTitle, load.status, readerTitle]);

  const changeMode = (next: string) => {
    setTab("feed");
    const patch: Partial<FilterState> = { mode: load.status === "ok" && next === load.defaultMode ? "" : next };
    // Civic mode lists only the civic circle (ui-revisions-1 item 5): other circles are dropped,
    // and with none left the feed shows All.
    if (next === "civic") {
      const civic = civicCircles(circles);
      const kept = filters.circles.filter((id) => civic.some((c) => c.id === id));
      if (kept.length !== filters.circles.length) patch.circles = kept;
    }
    setFilter(patch);
  };

  const setFilter = (patch: Partial<FilterState>) => {
    // A filter chosen while reading goes back to the feed, filtered.
    if (readerId) {
      feedScroll.current = null;
      window.history.replaceState(null, "", `/${window.location.search}`);
      setReaderId(null);
    }
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

  const endSession = (everywhere = false) => {
    void signOut(everywhere).then(() => window.location.assign("/"));
  };

  // Cards whose page might be framed ask the server as they come into view (ui-revisions-3 item 2).
  useVisibleFrameChecks(frames.request, load.status === "ok" ? load.items : null);

  if (load.status === "unknown_host") return <NotFound message={load.message} homeLink={false} />;

  const panel = load.status === "ok" ? load.panel : [];
  const items = load.status === "ok" ? load.items : [];
  // One card per hub process (ui-revisions-1 item 7); a card is unread while any of its items is.
  const groups = groupItems(items);
  const groupRead = (ids: string[]) => ids.every((id) => reads.isRead(id));
  const filterProps = {
    circles: shownCircles,
    value: filters,
    // "All" clears the circles; any other circle toggles (ui-revisions-4 item 1).
    onCircle: (circle: string) =>
      setFilter({ circles: circle === "All" ? [] : toggleCircle(filters.circles, circle, shownCircles) }),
    onType: (type: string) => setFilter({ types: toggleValue(filters.types, type, CONTENT_TYPES) }),
    onNetwork: (network: string) => setFilter({ networks: toggleValue(filters.networks, network, NETWORKS) }),
    onSearch: (q: string) => setFilter({ q: q.trim() }),
    sources: load.status === "ok" ? load.sources : [],
    onSource: (source: string) => setFilter({ source }),
  };

  return (
    <>
      {readerItem && external && (
        <ExternalView
          key={readerItem.id}
          itemId={readerItem.id}
          src={frameSrc}
          checking={checking}
          onOpened={() => reads.markRead([readerItem.id])}
          pageUrl={readerItem.url!}
          title={readerItem.title || `${kindLabel(readerItem.kind)} from ${boostedPost(readerItem)?.name ?? readerItem.space.name}`}
          host={readerHost ?? ""}
          onBack={closeReader}
        />
      )}
    {/* Framed, the embedded view replaces the River; the River stays mounted so Back finds it as it was. */}
    <div className="page" hidden={Boolean(readerItem && external)}>
      <a className="skip-link" href="#feed">
        Skip to the feed
      </a>
      {viewer === null && (
        // Visitors read the instance's sample River (ui-revisions-1 item 8).
        <p className="sample-banner" data-testid="sample-banner">
          Sample River<span aria-hidden="true"> · </span>
          <a href={SIGN_IN_URL}>Sign in</a> to make it your own
        </p>
      )}
      <Header
        title={topbarTitle(mode)}
        modes={modes}
        mode={chosenMode}
        onMode={changeMode}
        followingHref={withMode("/following", linkMode)}
        activityHref={withMode("/activity", linkMode)}
        linkedAccountsHref={withMode("/linked-accounts", linkMode)}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((open) => !open)}
        onPost={startPost}
        onFollow={(trigger) => {
          // Visitors: the sign-up note. Members: the follow box (the phone's Following tab, or the
          // Following page on a desktop).
          if (!viewer) setFollowTrigger(trigger);
          else if (window.matchMedia(PHONE_QUERY).matches) {
            setTab("following");
            window.setTimeout(() => document.getElementById("follow-input-phone")?.focus(), 0);
          } else window.location.assign(withMode("/following#follow", linkMode));
        }}
        viewer={viewer}
        onSignOut={endSession}
      />
      {searchOpen && (
        <div className="phone-search phone-only" id="phone-search">
          <SearchField id="search-phone" value={filters.q} onSearch={filterProps.onSearch} />
        </div>
      )}
      <div className={tab === "feed" && !readerId ? "phone-only filter-bar" : "phone-only hidden"}>
        <FilterButton
          circles={shownCircles}
          value={filters}
          expanded={sheetOpen}
          onOpen={openSheet}
          sources={load.status === "ok" ? load.sources : []}
        />
      </div>
      <FilterSheet {...filterProps} open={sheetOpen} onClose={sheetClosed} onClearAll={() => setFilter(CLEARED)} />

      {/* The columns stay the same while reading, so the filter column never moves (ui-revisions-2 item 1). */}
      <div className={["layout", panel.length > 0 ? "layout-panel" : "", readerState ? "layout-reading" : ""].filter(Boolean).join(" ")}>
        <div className="desktop-only filter-column">
          <FilterSidebar {...filterProps} onClearAll={() => setFilter(CLEARED)} />
        </div>

        <main className={tab === "feed" ? "feed" : "feed hidden-phone"} id="feed" tabIndex={-1}>
          {shownReaderState && (
            <ReaderView
              state={shownReaderState}
              read={readerItem ? reads.isRead(readerItem.id) : false}
              onBack={closeReader}
              onMarkRead={(id) => reads.markRead([id])}
              onMarkUnread={(id) => reads.markUnread([id])}
              onSampleInfo={(trigger) => setSampleTrigger(trigger)}
              now={now}
            />
          )}
          {/* The feed stays mounted while reading, so Back finds it exactly as it was. */}
          <div className="feed-body" hidden={Boolean(readerState)}>
            {/* No visible title or summary: the first card tops the column (ui-revisions-5 item 1). */}
            <h1 className="visually-hidden">{pageTitle}</h1>

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
                {groups.map((group) => {
                  const ids = groupIds(group);
                  return (
                    <li key={group.lead.id}>
                      <FeedCard
                        item={group.lead}
                        earlier={group.earlier}
                        open={cardOpen(group.lead, frames.answers[group.lead.id])}
                        read={groupRead(ids)}
                        now={now}
                        onMarkRead={() => reads.markRead(ids)}
                        onMarkUnread={() => reads.markUnread(ids)}
                        onSampleInfo={(trigger) => setSampleTrigger(trigger)}
                        onReply={hasLink ? (itemId, trigger) => setCompose({ trigger, replyTo: itemId, key: Date.now() }) : undefined}
                        onSource={(source) => {
                          // A card's source name: only that source, from the top (ui-revisions-11 item 2).
                          setFilter({ source });
                          window.scrollTo({ top: 0 });
                        }}
                        onOpen={(id) => {
                          // Opening a process's card reads its whole story.
                          if (ids.length > 1) reads.markRead(ids.filter((other) => other !== id));
                          openItem(id);
                        }}
                      />
                    </li>
                  );
                })}
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
          </div>
        </main>

        {panel.length > 0 && !readerId && (
          // Everything's Coming up sits below the feed on a phone; Civic's panel above it.
          <div
            className={[
              "plugin-column",
              mode === "everything" ? "plugin-column-after" : "",
              tab === "feed" ? "" : "hidden-phone",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <PluginPanel plugins={panel} label={`${modeTitle} panel`} />
          </div>
        )}

        {tab === "you" && (
          <section className="tab-placeholder phone-only" aria-labelledby="tab-title">
            <h1 id="tab-title">You</h1>
            <YouPanel
              viewer={viewer}
              onSignOut={endSession}
              activityHref={withMode("/activity", linkMode)}
              linkedAccountsHref={withMode("/linked-accounts", linkMode)}
              onPost={startPost}
            />
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
      {compose && <Composer key={compose.key} trigger={compose.trigger} replyToItemId={compose.replyTo} onClose={() => setCompose(null)} />}
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
    </>
  );
}
