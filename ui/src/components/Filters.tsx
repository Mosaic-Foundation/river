// Filters (spec F5, ui-revisions-1 items 2-4, ui-revisions-4 item 1): circles AND content types AND
// networks (each toggles, several at once, none means all; "All" clears the circles), plus search.
// Desktop: everything in the left column under "Filter your River", each section collapsible, the
// circles scrolling after six (ui-revisions-4 items 2-3). Phone: a chip row (content types,
// networks, then circles); search sits behind the header's search button. A compact "Clear all"
// shows while a filter is on: below search in the column (ui-revisions-3 item 5), first in the
// phone's chip row (ui-revisions-4 items 4-5; the chips above the feed are gone).
import { useEffect, useId, useRef, useState } from "react";
import type { FeedCircle } from "../lib/api";
import { hasActiveFilter, type FilterState } from "../lib/filters";
import { circleColor, CONTENT_TYPES, NETWORKS } from "../lib/format";
import { CheckIcon, ChevronIcon, SearchIcon } from "./Icons";

export type { FilterState };

export interface FiltersProps {
  circles: FeedCircle[];
  value: FilterState;
  /** "All" clears the circle selection; any other id toggles that circle. */
  onCircle: (circle: string) => void;
  onType: (type: string) => void;
  onNetwork: (network: string) => void;
  onSearch: (q: string) => void;
}

/** A circle's color reaches CSS as a custom property (set through the CSSOM, so CSP allows it). */
function swatch(color: string | null): React.CSSProperties | undefined {
  const value = circleColor(color);
  return value ? ({ "--circle-color": value } as React.CSSProperties) : undefined;
}

export function SearchField({ id, value, onSearch }: { id: string; value: string; onSearch: (q: string) => void }) {
  return (
    <form
      role="search"
      className="search"
      onSubmit={(e) => {
        e.preventDefault();
        const field = new FormData(e.currentTarget).get("q");
        onSearch(typeof field === "string" ? field : "");
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        Search your River
      </label>
      <SearchIcon className="search-icon" />
      <input
        // A new key when the search is cleared from outside (a chip's ✕, Clear all) empties the field.
        key={value === "" ? "empty" : "search"}
        id={id}
        name="q"
        type="search"
        className="search-input"
        placeholder="Search your River"
        defaultValue={value}
        maxLength={200}
        autoComplete="off"
        onChange={(e) => {
          // Clearing the field (or its clear button) shows everything again at once.
          if (e.currentTarget.value === "" && value !== "") onSearch("");
        }}
      />
      <button type="submit" className="visually-hidden-focusable search-submit">
        Search
      </button>
    </form>
  );
}

/** A toggle pill: pressed shows a dark fill and a check mark (ui-revisions-1 item 2). */
function Pill({ label, pressed, onToggle, title }: { label: string; pressed: boolean; onToggle: () => void; title?: string }) {
  return (
    <button type="button" className="pill" aria-pressed={pressed} onClick={onToggle} title={title}>
      {pressed && <CheckIcon className="pill-check" />}
      {label}
    </button>
  );
}

/** A sidebar section whose heading button collapses and expands it (ui-revisions-1 item 4). */
function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <nav className="filter-group" aria-labelledby={`${id}-heading`}>
      <h3 className="filter-heading" id={`${id}-heading`}>
        <button
          type="button"
          className="filter-toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={() => setOpen((o) => !o)}
        >
          {title}
          <ChevronIcon className="filter-chevron" />
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open}>
        {children}
      </div>
    </nav>
  );
}

const ALL: Pick<FeedCircle, "id" | "name" | "color"> = { id: "All", name: "All", color: null };

function allCircles(circles: FeedCircle[]): Array<Pick<FeedCircle, "id" | "name" | "color">> {
  return [ALL, ...circles];
}

/** "All" is on when no circle is; a circle is on when it is selected. */
function circlePressed(value: FilterState, id: string): boolean {
  return id === "All" ? value.circles.length === 0 : value.circles.includes(id);
}

/** "Clear all": a compact button in the theme's primary colour (ui-revisions-4 item 4). */
function ClearAll({ onClear, testId }: { onClear: () => void; testId: string }) {
  return (
    <button type="button" className="button-clear" data-testid={testId} onClick={onClear}>
      Clear all
    </button>
  );
}

/** A circle row: "All" is on when no circle is; a circle toggles. */
function CircleOption({ circle, value, onCircle }: { circle: Pick<FeedCircle, "id" | "name" | "color">; value: FilterState; onCircle: (id: string) => void }) {
  const pressed = circlePressed(value, circle.id);
  return (
    <li>
      <button type="button" className="filter-option" aria-pressed={pressed} onClick={() => onCircle(circle.id)}>
        <span className="circle-swatch" style={swatch(circle.color)} aria-hidden="true" />
        <span className="filter-option-name">{circle.name}</span>
        {pressed && <CheckIcon className="pill-check filter-option-check" />}
      </button>
    </li>
  );
}

/** Whether the element's content is taller than the element (it scrolls). */
function useOverflows(ref: React.RefObject<HTMLElement | null>, key: unknown): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, key]);
  return overflows;
}

export function FilterSidebar({
  circles,
  value,
  onCircle,
  onType,
  onNetwork,
  onSearch,
  onClearAll,
}: FiltersProps & { onClearAll: () => void }) {
  const asideRef = useRef<HTMLElement>(null);
  const circleScroll = useRef<HTMLDivElement>(null);
  // Six circles show; more scroll inside the section, with a hint (ui-revisions-4 item 2).
  const circlesScroll = useOverflows(circleScroll, circles.length);
  return (
    <aside className="sidebar" aria-label="Filters" ref={asideRef}>
      <h2 className="sidebar-title">Filter your River</h2>
      <SearchField id="search-desktop" value={value.q} onSearch={onSearch} />
      {hasActiveFilter(value) && (
        <ClearAll
          testId="sidebar-clear"
          onClear={() => {
            onClearAll();
            // The button goes away with the filters; focus moves to the search field.
            window.setTimeout(() => asideRef.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus(), 0);
          }}
        />
      )}

      <FilterSection title="Circles">
        <ul className="filter-list">
          <CircleOption circle={ALL} value={value} onCircle={onCircle} />
        </ul>
        <div
          className={circlesScroll ? "circle-scroll circle-scroll-more" : "circle-scroll"}
          ref={circleScroll}
          data-testid="circle-scroll"
        >
          <ul className="filter-list">
            {circles.map((c) => (
              <CircleOption key={c.id} circle={c} value={value} onCircle={onCircle} />
            ))}
          </ul>
        </div>
        {circlesScroll && (
          <p className="circle-scroll-hint" data-testid="circle-scroll-hint">
            <ChevronIcon className="circle-scroll-chevron" />
            Scroll for more circles
          </p>
        )}
      </FilterSection>

      <FilterSection title="Content type">
        <ul className="pill-list">
          {CONTENT_TYPES.map((t) => (
            <li key={t.value}>
              <Pill label={t.label} pressed={value.types.includes(t.value)} onToggle={() => onType(t.value)} />
            </li>
          ))}
        </ul>
      </FilterSection>

      <FilterSection title="Networks">
        <ul className="pill-list">
          {NETWORKS.map((n) => (
            <li key={n.value}>
              <Pill label={n.label} pressed={value.networks.includes(n.value)} onToggle={() => onNetwork(n.value)} />
              {n.detail && <span className="pill-detail">{n.detail}</span>}
            </li>
          ))}
        </ul>
      </FilterSection>
    </aside>
  );
}

export function FilterChips({
  circles,
  value,
  onCircle,
  onType,
  onNetwork,
  onClearAll,
}: Omit<FiltersProps, "onSearch"> & { onClearAll: () => void }) {
  return (
    <div className="chip-row" role="group" aria-label="Filters">
      {hasActiveFilter(value) && <ClearAll testId="chips-clear" onClear={onClearAll} />}
      <ul className="chip-list" aria-label="Content type">
        {CONTENT_TYPES.map((t) => (
          <li key={t.value}>
            <Pill label={t.label} pressed={value.types.includes(t.value)} onToggle={() => onType(t.value)} />
          </li>
        ))}
      </ul>
      <ul className="chip-list" aria-label="Networks">
        {NETWORKS.map((n) => (
          <li key={n.value}>
            <Pill
              label={n.label}
              title={n.detail}
              pressed={value.networks.includes(n.value)}
              onToggle={() => onNetwork(n.value)}
            />
          </li>
        ))}
      </ul>
      <ul className="chip-list" aria-label="Circles">
        {allCircles(circles).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="chip"
              aria-pressed={circlePressed(value, c.id)}
              onClick={() => onCircle(c.id)}
            >
              {circlePressed(value, c.id) && <CheckIcon className="pill-check" />}
              {c.color && <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />}
              {c.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
