// Filters (spec F5): circle (one at a time, "All" default) AND content type, plus search.
// Desktop: everything in the left column. Phone: a chip row (content type, then circles); search
// sits behind the header's search button.
import type { FeedCircle } from "../lib/api";
import { circleColor, CONTENT_TYPES } from "../lib/format";
import { SearchIcon } from "./Icons";

export interface FilterState {
  circle: string;
  type: string;
  q: string;
}

export interface FiltersProps {
  circles: FeedCircle[];
  value: FilterState;
  onCircle: (circle: string) => void;
  onType: (type: string) => void;
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

export function FilterSidebar({ circles, value, onCircle, onType, onSearch }: FiltersProps) {
  const allCircles: Array<Pick<FeedCircle, "id" | "name" | "color">> = [{ id: "All", name: "All", color: null }, ...circles];
  return (
    <aside className="sidebar" aria-label="Filters">
      <SearchField id="search-desktop" value={value.q} onSearch={onSearch} />

      <nav className="filter-group" aria-labelledby="filter-circles">
        <h2 className="filter-heading" id="filter-circles">
          Circles
        </h2>
        <ul className="filter-list">
          {allCircles.map((c) => (
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
      </nav>

      <nav className="filter-group" aria-labelledby="filter-types">
        <h2 className="filter-heading" id="filter-types">
          Content type
        </h2>
        <ul className="filter-list">
          {CONTENT_TYPES.map((t) => (
            <li key={t.value}>
              <button
                type="button"
                className="filter-option"
                aria-pressed={value.type === t.value}
                onClick={() => onType(t.value)}
              >
                {t.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}

export function FilterChips({ circles, value, onCircle, onType }: Omit<FiltersProps, "onSearch">) {
  const allCircles: Array<Pick<FeedCircle, "id" | "name" | "color">> = [{ id: "All", name: "All", color: null }, ...circles];
  return (
    <div className="chip-row" role="group" aria-label="Filters">
      <label className="visually-hidden" htmlFor="type-chip">
        Content type
      </label>
      <select
        id="type-chip"
        className="chip chip-select"
        value={value.type}
        onChange={(e) => onType(e.currentTarget.value)}
      >
        {CONTENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.value === "all" ? "All types" : t.label}
          </option>
        ))}
      </select>
      <ul className="chip-list" aria-label="Circles">
        {allCircles.map((c) => (
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
