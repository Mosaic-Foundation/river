// Circles (spec F8, members): create, rename, recolor and delete circles, and choose which followed
// spaces are in each. A space can be in several circles. The civic circle keeps its role when
// renamed and can't be deleted (Civic mode reads it).
import { useId, useState } from "react";
import { circleColor } from "../lib/format";
import {
  addToCircle,
  CIRCLE_COLORS,
  createCircle,
  deleteCircle,
  removeFromCircle,
  spacesCount,
  updateCircle,
  type CircleView,
  type FollowingPage,
  type Result,
} from "../lib/following";
import { useLocalRun, type Run as SharedRun } from "./useFollowing";

function swatch(color: string | null): React.CSSProperties | undefined {
  const value = circleColor(color);
  return value ? ({ "--circle-color": value } as React.CSSProperties) : undefined;
}

function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  const name = useId();
  return (
    <fieldset className="color-picker">
      <legend>{label}</legend>
      {CIRCLE_COLORS.map((c) => (
        <label key={c.value} className="color-option">
          <input
            type="radio"
            name={name}
            value={c.value}
            checked={value.toUpperCase() === c.value}
            onChange={() => onChange(c.value)}
          />
          <span className="circle-swatch circle-swatch-large" style={swatch(c.value)} aria-hidden="true" />
          <span className="visually-hidden">{c.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

type Run = (change: () => Promise<Result<unknown>>) => Promise<boolean>;

function CircleEditor({ circle, page, run, busy, onDone }: { circle: CircleView; page: FollowingPage; run: Run; busy: boolean; onDone: () => void }) {
  const [name, setName] = useState(circle.name);
  const [color, setColor] = useState(circle.color ?? CIRCLE_COLORS[0]!.value);
  const nameId = useId();
  const followed = page.spaces.filter((s) => s.following || s.streams.some((st) => st.rule === "follow"));
  return (
    <div className="circle-editor">
      <form
        className="circle-form"
        onSubmit={(e) => {
          e.preventDefault();
          const change: { name?: string; color?: string } = {};
          if (name.trim() !== circle.name) change.name = name;
          if (color !== circle.color) change.color = color;
          if (Object.keys(change).length === 0) {
            onDone();
            return;
          }
          void run(() => updateCircle(circle.id, change)).then((ok) => {
            if (ok) onDone();
          });
        }}
      >
        <label htmlFor={nameId}>Name</label>
        <input id={nameId} className="text-input" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
        <ColorPicker value={color} onChange={setColor} label="Color" />
        <div className="circle-form-actions">
          <button type="submit" className="button button-small button-primary" disabled={busy}>
            Save
          </button>
          <button type="button" className="button button-small button-quiet" onClick={onDone}>
            Done
          </button>
        </div>
      </form>
      <fieldset className="circle-members">
        <legend>Spaces in {circle.name}</legend>
        {followed.length === 0 && <p className="panel-text">Follow a space to add it here.</p>}
        {followed.map((s) => {
          const inCircle = circle.spaceIds.includes(s.id);
          return (
            <label key={s.id} className="checkbox">
              <input
                type="checkbox"
                checked={inCircle}
                disabled={busy}
                onChange={() => run(() => (inCircle ? removeFromCircle(circle.id, s.id) : addToCircle(circle.id, s.id)))}
              />
              {s.name}
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}

export function CirclesPanel({ page, run: shared, busy }: { page: FollowingPage; run: SharedRun; busy: boolean }) {
  const { run, error } = useLocalRun(shared);
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(CIRCLE_COLORS[0]!.value);
  const headingId = useId();
  const newNameId = useId();

  return (
    <section className="panel circles-panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-title">
        Circles
      </h2>
      <p className="panel-text">Groups of spaces. Any mode can use any circle.</p>
      {error && (
        <p className="follow-error" role="alert">
          {error}
        </p>
      )}
      <ul className="circle-list">
        {page.circles.map((c) => (
          <li key={c.id} className="circle-row" data-testid="circle-row">
            <div className="circle-row-main">
              <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />
              <span className="circle-name">{c.name}</span>
              <span className="circle-count">{spacesCount(c.spaceIds.length)}</span>
              <button
                type="button"
                className="button button-small button-quiet"
                aria-expanded={editing === c.id}
                aria-label={`Edit ${c.name}`}
                onClick={() => setEditing(editing === c.id ? null : c.id)}
              >
                Edit
              </button>
              {c.role !== "civic" && (
                <button
                  type="button"
                  className="button button-small button-quiet"
                  disabled={busy}
                  aria-label={`Delete ${c.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete the circle "${c.name}"? The spaces in it stay followed.`)) {
                      void run(() => deleteCircle(c.id));
                    }
                  }}
                >
                  Delete
                </button>
              )}
            </div>
            {editing === c.id && <CircleEditor circle={c} page={page} run={run} busy={busy} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
      {adding ? (
        <form
          className="circle-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => createCircle(name, color)).then((ok) => {
              if (!ok) return;
              setName("");
              setAdding(false);
            });
          }}
        >
          <label htmlFor={newNameId}>New circle name</label>
          <input
            id={newNameId}
            className="text-input"
            value={name}
            maxLength={60}
            required
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <ColorPicker value={color} onChange={setColor} label="Color" />
          <div className="circle-form-actions">
            <button type="submit" className="button button-small button-primary" disabled={busy}>
              Create circle
            </button>
            <button type="button" className="button button-small button-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="button button-dashed" onClick={() => setAdding(true)}>
          + New circle
        </button>
      )}
      <div className="panel-aside">
        <p className="panel-aside-title">Your list is yours</p>
        <p>What you follow and your circles belong to you, not to this site. Exporting them to take elsewhere is coming.</p>
      </div>
    </section>
  );
}
