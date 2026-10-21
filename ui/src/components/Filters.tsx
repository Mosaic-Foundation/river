// Filters (spec F5, ui-revisions-1 items 2-4): circle (one at a time, "All" default) AND content
// types AND networks (toggle pills, several at once, none means all), plus search. Desktop:
// everything in the left column, each section collapsible. Phone: a chip row (content types,
// networks, then circles); search sits behind the header's search button. Above the feed, a chip
// per active filter with its own ✕, and "Clear all".
import { useId, useState } from "react";
import type { FeedCircle } from "../lib/api";
import { circleColor, CONTENT_TYPES, NETWORKS } from "../lib/format";
import { CheckIcon, ChevronIcon, CloseIcon, SearchIcon } from "./Icons";

export interface FilterState {
  /** The mode (spec F9): "" for the instance's default. Set by the header's switch, not here. */
  mode: string;
  circle: string;
  /** Content-type values (CONTENT_TYPES); empty for All. */
  types: string[];
  /** Network values (NETWORKS); empty for every network. */
  networks: string[];
  q: string;
}

export interface FiltersProps {
  circles: FeedCircle[];
  value: FilterState;
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
      <h2 className="filter-heading" id={`${id}-heading`}>
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
      </h2>
      <div id={`${id}-body`} hidden={!open}>
        {children}
      </div>
    </nav>
  );
}

function allCircles(circles: FeedCircle[]): Array<Pick<FeedCircle, "id" | "name" | "color">> {
  return [{ id: "All", name: "All", color: null }, ...circles];
}

export function FilterSidebar({ circles, value, onCircle, onType, onNetwork, onSearch }: FiltersProps) {
  return (
    <aside className="sidebar" aria-label="Filters">
      <SearchField id="search-desktop" value={value.q} onSearch={onSearch} />

      <FilterSection title="Circles">
        <ul className="filter-list">
          {allCircles(circles).map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="filter-option"
                aria-pressed={value.circle === c.id}
                onClick={() => onCircle(c.id)}
              >
                <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />
                {c.name}
              </button>
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
    </aside>
  );
}

export function FilterChips({ circles, value, onCircle, onType, onNetwork }: Omit<FiltersProps, "onSearch">) {
  return (
    <div className="chip-row" role="group" aria-label="Filters">
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
              aria-pressed={value.circle === c.id}
              onClick={() => onCircle(c.id)}
            >
              {c.color && <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />}
              {c.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ActiveFiltersProps {
  circles: FeedCircle[];
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
}

/** One chip per active filter, each with an ✕, plus "Clear all" (ui-revisions-1 item 3). */
export function ActiveFilters({ circles, value, onChange }: ActiveFiltersProps) {
  const chips: Array<{ key: string; label: string; remove: Partial<FilterState> }> = [];
  if (value.circle !== "All") {
    const name = circles.find((c) => c.id === value.circle)?.name ?? value.circle;
    chips.push({ key: "circle", label: `Circle: ${name}`, remove: { circle: "All" } });
  }
  for (const t of CONTENT_TYPES.filter((t) => value.types.includes(t.value))) {
    chips.push({ key: `type-${t.value}`, label: t.label, remove: { types: value.types.filter((v) => v !== t.value) } });
  }
  for (const n of NETWORKS.filter((n) => value.networks.includes(n.value))) {
    chips.push({
      key: `network-${n.value}`,
      label: n.label,
      remove: { networks: value.networks.filter((v) => v !== n.value) },
    });
  }
  if (value.q) chips.push({ key: "q", label: `Search: “${value.q}”`, remove: { q: "" } });
  if (chips.length === 0) return null;
  return (
    <div className="active-filters" role="group" aria-label="Active filters" data-testid="active-filters">
      <ul className="active-filter-list">
        {chips.map((chip) => (
          <li key={chip.key} className="active-filter" data-testid="active-filter">
            <span>{chip.label}</span>
            <button
              type="button"
              className="active-filter-remove"
              aria-label={`Remove filter: ${chip.label}`}
              onClick={() => onChange(chip.remove)}
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="button button-quiet active-filters-clear"
        onClick={() => onChange({ circle: "All", types: [], networks: [], q: "" })}
      >
        Clear all
      </button>
    </div>
  );
}
