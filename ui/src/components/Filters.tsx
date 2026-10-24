// Filters (spec F5, ui-revisions-1 items 2-4, ui-revisions-4 item 1): circles AND content types AND
// networks (each toggles, several at once, none means all; "All" clears the circles), plus search.
// Desktop: everything in the left column under "Filter your River", each section collapsible, the
// circles as wrapping pills like the content types, scrolling after four rows (ui-revisions-8
// item 2; ui-revisions-4 items 2-3). Phone: one "Filter your River" button
// that opens a bottom sheet with the same content as wrapping pills (ui-revisions-6). A compact
// "Clear all" shows while a filter is on, below search in the column and in the sheet
// (ui-revisions-3 item 5, ui-revisions-4 item 4).
import { useEffect, useId, useRef, useState } from "react";
import type { FeedCircle } from "../lib/api";
import { activeFilterCount, filterSummary, hasActiveFilter, type FilterState } from "../lib/filters";
import { circleColor, CONTENT_TYPES, NETWORKS } from "../lib/format";
import { CheckIcon, ChevronIcon, FilterIcon, SearchIcon } from "./Icons";

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
function Pill({
  label,
  pressed,
  onToggle,
  title,
  color,
}: {
  label: string;
  pressed: boolean;
  onToggle: () => void;
  title?: string;
  /** A circle's color, shown as its swatch (the phone sheet's circle pills). */
  color?: string | null;
}) {
  return (
    <button type="button" className="pill" aria-pressed={pressed} onClick={onToggle} title={title}>
      {pressed && <CheckIcon className="pill-check" />}
      {color && <span className="circle-swatch" style={swatch(color)} aria-hidden="true" />}
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
  // Four rows of circle pills show; more scroll inside the section, with a hint (ui-revisions-8
  // item 2, after ui-revisions-4 item 2).
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
        <div
          className={circlesScroll ? "circle-scroll circle-scroll-more" : "circle-scroll"}
          ref={circleScroll}
          data-testid="circle-scroll"
        >
          <ul className="pill-list">
            {allCircles(circles).map((c) => (
              <li key={c.id}>
                <Pill label={c.name} pressed={circlePressed(value, c.id)} onToggle={() => onCircle(c.id)} color={c.color} />
              </li>
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

export interface FilterButtonProps {
  circles: FeedCircle[];
  value: FilterState;
  expanded: boolean;
  onOpen: (trigger: HTMLButtonElement) => void;
}

/**
 * The phone's one filter button (ui-revisions-6 item 1): "Filter your River", with a count and a
 * one-line summary of what's on when any filter is.
 */
export function FilterButton({ circles, value, expanded, onOpen }: FilterButtonProps) {
  const count = activeFilterCount(value);
  const summary = filterSummary(value, circles, { types: CONTENT_TYPES, networks: NETWORKS });
  return (
    <button
      type="button"
      className="filter-button"
      data-testid="filter-button"
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={(e) => onOpen(e.currentTarget)}
    >
      <FilterIcon className="filter-button-icon" />
      <span className="filter-button-text">
        <span className="filter-button-title" data-testid="filter-button-title">
          Filter your River
          {count > 0 && (
            <>
              {" · "}
              <span data-testid="filter-count">{count}</span>
              <span className="visually-hidden">{count === 1 ? " filter on" : " filters on"}</span>
            </>
          )}
        </span>
        {summary && (
          <span className="filter-button-summary" data-testid="filter-summary">
            {summary}
          </span>
        )}
      </span>
    </button>
  );
}

/** Pixels the handle must travel down before letting go closes the sheet. */
const SWIPE_CLOSE = 80;

export interface FilterSheetProps extends FiltersProps {
  open: boolean;
  /** Called once the sheet has closed (by any route); the selections stay. */
  onClose: () => void;
  onClearAll: () => void;
}

/**
 * The phone's filter sheet (ui-revisions-6 items 2-4): a modal bottom sheet on the native
 * <dialog> (showModal() traps focus, Escape closes it), with the desktop column's content as
 * wrapping pills. Filters apply as they're toggled. "Show results", the drag handle (a tap or a
 * swipe down), a tap outside, Escape and the back gesture all close it.
 */
export function FilterSheet({ circles, value, onCircle, onType, onNetwork, onSearch, open, onClose, onClearAll }: FilterSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const drag = useRef<{ start: number; moved: number } | null>(null);
  const dragged = useRef(false);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setOffset(0);
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      className="filter-sheet"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="filter-sheet"
      // The handle's drag moves the sheet down (set through the CSSOM, so CSP allows it).
      style={offset > 0 ? ({ "--sheet-drag": `${offset}px` } as React.CSSProperties) : undefined}
      onClose={onClose}
      onClick={(e) => {
        // A tap on the backdrop (the dialog element itself, outside its panel) closes it.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="filter-sheet-panel">
        <button
          type="button"
          className="filter-sheet-handle"
          aria-label="Close filters"
          data-testid="filter-sheet-handle"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { start: e.clientY, moved: 0 };
          }}
          onPointerMove={(e) => {
            // Only while pressed: drag is set on pointerdown and cleared on release.
            if (!drag.current) return;
            drag.current.moved = Math.max(0, e.clientY - drag.current.start);
            setOffset(drag.current.moved);
          }}
          onPointerUp={() => {
            const moved = drag.current?.moved ?? 0;
            drag.current = null;
            if (moved >= SWIPE_CLOSE) close();
            else setOffset(0);
            // A drag isn't a tap: the click that may follow this release mustn't close the sheet.
            // A touch swipe often sends no click, so the flag lasts only until this task ends.
            if (moved >= 6) {
              dragged.current = true;
              window.setTimeout(() => (dragged.current = false), 0);
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setOffset(0);
          }}
          onClick={() => {
            // A tap (or Enter) closes; a short drag that snapped back doesn't.
            if (!dragged.current) close();
          }}
        >
          <span className="filter-sheet-grip" aria-hidden="true" />
        </button>

        <div className="filter-sheet-body">
          <h2 className="sidebar-title" id={titleId}>
            Filter your River
          </h2>
          <SearchField id="search-sheet" value={value.q} onSearch={onSearch} />
          {hasActiveFilter(value) && (
            <ClearAll
              testId="sheet-clear"
              onClear={() => {
                onClearAll();
                // The sheet stays open; focus moves to its search field as the button goes.
                window.setTimeout(() => ref.current?.querySelector<HTMLInputElement>("input[type=search]")?.focus(), 0);
              }}
            />
          )}

          <FilterSection title="Circles">
            <ul className="pill-list">
              {allCircles(circles).map((c) => (
                <li key={c.id}>
                  <Pill label={c.name} pressed={circlePressed(value, c.id)} onToggle={() => onCircle(c.id)} color={c.color} />
                </li>
              ))}
            </ul>
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
        </div>

        <div className="filter-sheet-footer">
          <button type="button" className="button button-primary filter-sheet-done" onClick={close}>
            Show results
          </button>
        </div>
      </div>
    </dialog>
  );
}
