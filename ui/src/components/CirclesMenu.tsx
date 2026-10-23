// A Following row's circles menu (ui-revisions-7): a menu button showing the circles the row is
// in, opening a menu of every circle to check or uncheck, and "New circle…" to make one with the
// row in it. Each click saves at once (addToCircle, removeFromCircle) and shows at once; a refused
// save is undone and its sentence shown. Escape, a click outside and Done close it, and focus goes
// back to the button. Below 56rem the same menu is a small bottom sheet (following.css).
import { useEffect, useId, useRef, useState } from "react";
import { circleColor } from "../lib/format";
import {
  addToCircle,
  createCircle,
  nextCircleColor,
  removeFromCircle,
  toggleId,
  type CircleView,
  type Result,
} from "../lib/following";
import { CheckIcon, ChevronIcon } from "./Icons";
import type { Run } from "./useFollowing";

function swatch(color: string | null): React.CSSProperties | undefined {
  const value = circleColor(color);
  return value ? ({ "--circle-color": value } as React.CSSProperties) : undefined;
}

export interface CirclesMenuProps {
  space: { id: string; name: string; circleIds: string[] };
  circles: readonly CircleView[];
  /** The page's run(): saves, then reloads the page and the feed; true, or the sentence to show. */
  run: Run;
}

/**
 * The row's circle ids as shown: the saved ones, or the member's clicks while their saves are on
 * the way. Once nothing is on the way, the next page load wins again.
 */
function useShownCircles(saved: string[], run: Run) {
  const [override, setOverride] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0);

  useEffect(() => {
    if (pending.current === 0) setOverride(null);
  }, [saved]);

  const save = async (id: string, change: () => Promise<Result<unknown>>) => {
    pending.current += 1;
    setError(null);
    setOverride((ids) => toggleId(ids ?? saved, id));
    const outcome = await run(change);
    pending.current -= 1;
    if (outcome !== true) {
      // Undo just this click; any other on the way keeps its own.
      setOverride((ids) => toggleId(ids ?? saved, id));
      setError(outcome);
    }
    return outcome === true;
  };

  return { ids: override ?? saved, error, setError, save };
}

export function CirclesMenu({ space, circles, run }: CirclesMenuProps) {
  const { ids, error, setError, save } = useShownCircles(space.circleIds, run);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  // A circle just made here, shown until the page's reload brings it.
  const [made, setMade] = useState<CircleView | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const titleId = useId();
  const newNameId = useId();
  // A circle just made here takes focus once its item has rendered.
  const focusNext = useRef<string | null>(null);

  const all = made && !circles.some((c) => c.id === made.id) ? [...circles, made] : [...circles];
  const inRow = all.filter((c) => ids.includes(c.id));
  // The menu's items: every circle, then "New circle…".
  const itemCount = all.length + 1;

  const items = () => [...(popupRef.current?.querySelectorAll<HTMLElement>("[role=menu] > li > [role^=menuitem]") ?? [])];
  const focusItem = (index: number) => {
    const next = (index + itemCount) % itemCount;
    setActive(next);
    items()[next]?.focus();
  };

  const close = (refocus = true) => {
    setOpen(false);
    setCreating(false);
    setNewName("");
    if (refocus) buttonRef.current?.focus();
  };

  // Opening starts on the first circle the row is in, else the first item, and focus goes there.
  const openMenu = () => {
    setActive(Math.max(0, all.findIndex((c) => ids.includes(c.id))));
    setOpen(true);
  };

  useEffect(() => {
    if (open) items()[active]?.focus();
    // Only when it opens: later clicks keep focus where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!focusNext.current) return;
    const item = popupRef.current?.querySelector<HTMLElement>(`[data-circle-id="${focusNext.current}"]`);
    if (!item) return;
    focusNext.current = null;
    item.focus();
  });

  // A click outside closes it. The phone's backdrop closes it on its own click, so the tap can't
  // land on what was under it.
  const backdropRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if ([popupRef, buttonRef, backdropRef].some((r) => r.current?.contains(target))) return;
      close(false);
      // Focus goes back to the button, unless the click put it on something else.
      window.setTimeout(() => {
        const now = document.activeElement;
        if (!now || now === document.body) buttonRef.current?.focus();
      }, 0);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const toggle = (circle: CircleView) => {
    const inCircle = ids.includes(circle.id);
    void save(circle.id, () => (inCircle ? removeFromCircle(circle.id, space.id) : addToCircle(circle.id, space.id)));
  };

  const createAndAdd = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError(null);
    const created = await createCircle(name, nextCircleColor(all));
    setSaving(false);
    if (!created.ok) {
      setError(created.message);
      return;
    }
    const circle = { ...created.value.circle, spaceIds: [] };
    setMade(circle);
    setCreating(false);
    setNewName("");
    focusNext.current = circle.id;
    await save(circle.id, () => addToCircle(circle.id, space.id));
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") focusItem(active + 1);
    else if (e.key === "ArrowUp") focusItem(active - 1);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(itemCount - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="circles-menu">
      <button
        ref={buttonRef}
        type="button"
        className="circles-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid="circles-button"
        onClick={() => (open ? close() : openMenu())}
      >
        {/* Its name is its text, so what it says is what a screen reader hears: "Circles for EFF:
            Family, News and ideas", or "Circles for EFF: none" under the visible "Circles". */}
        {inRow.length === 0 ? (
          <span className="circles-button-empty">
            Circles<span className="visually-hidden"> for {space.name}: none</span>
          </span>
        ) : (
          <>
            <span className="visually-hidden">Circles for {space.name}: </span>
            {inRow.map((c, i) => (
              <span key={c.id} className="circles-button-circle">
                <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />
                {c.name}
                {i < inRow.length - 1 && <span className="visually-hidden">, </span>}
              </span>
            ))}
          </>
        )}
        <ChevronIcon className="circles-button-chevron" />
      </button>
      {!open && error && (
        <p className="circles-menu-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <>
          <div
            ref={backdropRef}
            className="circles-menu-backdrop"
            aria-hidden="true"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => close()}
          />
          <div
            ref={popupRef}
            className="circles-menu-popup"
            data-testid="circles-menu"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            onBlur={(e) => {
              // Tabbing out of the menu closes it; focus stays where it went.
              const next = e.relatedTarget as Node | null;
              if (next && !popupRef.current?.contains(next) && next !== buttonRef.current) close(false);
            }}
          >
            <span className="circles-menu-grip" aria-hidden="true" />
            <p className="circles-menu-title" id={titleId}>
              Circles for {space.name}
            </p>
            <ul className="circles-menu-list" role="menu" id={menuId} aria-labelledby={titleId} onKeyDown={onMenuKeyDown}>
              {all.map((c, i) => {
                const checked = ids.includes(c.id);
                return (
                  <li key={c.id} role="none">
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={checked}
                      className="circles-menu-item"
                      data-circle-id={c.id}
                      tabIndex={i === active ? 0 : -1}
                      onFocus={() => setActive(i)}
                      onClick={() => toggle(c)}
                    >
                      <span className="circles-menu-check" aria-hidden="true">
                        {checked && <CheckIcon />}
                      </span>
                      <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />
                      <span className="circles-menu-name">{c.name}</span>
                    </button>
                  </li>
                );
              })}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="circles-menu-item circles-menu-new"
                  aria-expanded={creating}
                  tabIndex={active === all.length ? 0 : -1}
                  onFocus={() => setActive(all.length)}
                  onClick={() => setCreating(true)}
                >
                  New circle…
                </button>
              </li>
            </ul>
            {creating && (
              <form
                className="circles-menu-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createAndAdd();
                }}
              >
                <label htmlFor={newNameId}>New circle name</label>
                <input
                  id={newNameId}
                  className="text-input"
                  value={newName}
                  maxLength={60}
                  required
                  autoFocus
                  onChange={(e) => setNewName(e.currentTarget.value)}
                />
                <div className="circles-menu-form-actions">
                  <button type="submit" className="button button-small button-primary" disabled={saving}>
                    {saving ? "Creating…" : "Create and add"}
                  </button>
                  <button
                    type="button"
                    className="button button-small button-quiet"
                    onClick={() => {
                      setCreating(false);
                      setNewName("");
                      focusItem(all.length);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
            {error && (
              <p className="circles-menu-error" role="alert">
                {error}
              </p>
            )}
            <div className="circles-menu-footer">
              <button type="button" className="button button-small button-primary circles-menu-done" onClick={() => close()}>
                Done
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
