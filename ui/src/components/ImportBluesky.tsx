// "Import from Bluesky" on the Follow screen (docs/spec/bluesky-1.md item 4, members). The member
// types a Bluesky handle; the River lists the accounts it follows (getFollows, on the server) and
// shows who, how many and the first names. The member chooses a circle (or none) and follows them
// all. Their posts fill in over the next opens of the River: each open refreshes a few (DECISIONS.md
// "Refreshing hundreds of Bluesky accounts"). The preview also lists the Bluesky accounts the member
// follows here that the account no longer follows, unchecked: the member checks the ones to
// unfollow (or all of them), and the button says what one click does (DECISIONS.md). Errors are
// the server's F6 sentences.
import { useId, useState } from "react";
import { circleColor } from "../lib/format";
import {
  importBluesky,
  importButtonLabel,
  importCountSentence,
  importDoneSentence,
  importWho,
  previewBlueskyImport,
  type CircleView,
  type ImportPreview,
} from "../lib/following";
import { SourceIcon } from "./SourceIcon";

type State =
  | { step: "idle" }
  | { step: "looking" }
  | { step: "preview"; input: string; preview: ImportPreview }
  | { step: "importing"; input: string; preview: ImportPreview }
  | { step: "done"; sentence: string };

function swatch(color: string | null): React.CSSProperties | undefined {
  const value = circleColor(color);
  return value ? ({ "--circle-color": value } as React.CSSProperties) : undefined;
}

export function ImportBluesky({ circles, onImported }: { circles: CircleView[]; onImported: () => void }) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [circleId, setCircleId] = useState("");
  // The removals the member checks: unfollowed with the import. None are checked to start with.
  const [unfollow, setUnfollow] = useState<ReadonlySet<string>>(new Set());
  const removalsHint = useId();
  const headingId = useId();
  const hintId = useId();
  const inputId = useId();
  const circleName = useId();

  const lookUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = text.trim();
    if (!input) {
      setError("Type a Bluesky handle like @name.bsky.social.");
      return;
    }
    setError(null);
    setState({ step: "looking" });
    const result = await previewBlueskyImport(input);
    if (!result.ok) {
      setState({ step: "idle" });
      setError(result.message);
      return;
    }
    setCircleId("");
    setUnfollow(new Set());
    setState({ step: "preview", input, preview: result.value });
  };

  const importAll = async () => {
    if (state.step !== "preview") return;
    const { input, preview } = state;
    setState({ step: "importing", input, preview });
    setError(null);
    const confirmed = (preview.removals ?? []).map((r) => r.spaceId).filter((id) => unfollow.has(id));
    const result = await importBluesky(input, circleId ? [circleId] : [], confirmed);
    if (!result.ok) {
      setState({ step: "preview", input, preview });
      setError(result.message);
      return;
    }
    const circle = circles.find((c) => c.id === circleId)?.name ?? null;
    setState({ step: "done", sentence: importDoneSentence(result.value, circle, importWho(preview)) });
    setText("");
    onImported();
  };

  const shown = state.step === "preview" || state.step === "importing" ? state.preview : undefined;
  const removals = shown?.removals ?? [];
  const unfollowCount = removals.filter((r) => unfollow.has(r.spaceId)).length;

  return (
    <section className="panel follow-box import-box" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-title">
        Import from Bluesky
      </h2>
      <p className="panel-text" id={hintId}>
        Type a Bluesky handle to follow every account it follows, in one step.
      </p>
      <form className="follow-form" onSubmit={lookUp}>
        <label className="visually-hidden" htmlFor={inputId}>
          Bluesky handle
        </label>
        <input
          id={inputId}
          className="text-input follow-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          placeholder="@name.bsky.social"
          aria-describedby={hintId}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            if (state.step === "done") setState({ step: "idle" });
          }}
        />
        <button type="submit" className="button button-secondary" disabled={state.step === "looking"}>
          {state.step === "looking" ? "Looking…" : "List follows"}
        </button>
      </form>

      {error && (
        <p className="follow-error" role="alert">
          {error}
        </p>
      )}
      {state.step === "done" && (
        <p className="follow-done" role="status">
          {state.sentence}
        </p>
      )}

      {shown && (
        <div className="follow-preview" data-testid="import-preview">
          <div className="follow-preview-head">
            <SourceIcon name={shown.account.name} iconUrl={shown.account.iconUrl} />
            <div>
              <p className="follow-preview-name">{shown.account.name}</p>
              <p className="follow-preview-meta" data-testid="import-count">
                {importCountSentence(shown)}
              </p>
            </div>
          </div>
          {shown.accounts.length > 0 && (
            <ul className="import-names" aria-label="Some of the accounts">
              {shown.accounts.map((a) => (
                <li key={a.did} className="import-name">
                  <SourceIcon name={a.name} iconUrl={a.iconUrl} />
                  <span>
                    <span className="import-name-text">{a.name}</span>
                    {a.handle && <span className="import-name-handle"> @{a.handle}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {removals.length > 0 && (
            <fieldset className="import-removals" data-testid="import-removals" aria-describedby={removalsHint}>
              <legend>No longer followed by {importWho(shown)}</legend>
              <p className="panel-text" id={removalsHint}>
                You follow {removals.length === 1 ? "this account" : `these ${removals.length} accounts`} here, but{" "}
                {importWho(shown)} doesn't any more. Check the ones to unfollow here too; the rest stay followed.
              </p>
              {removals.length > 1 && (
                <button
                  type="button"
                  className="button button-small button-quiet import-check-all"
                  onClick={() => setUnfollow(unfollowCount === removals.length ? new Set() : new Set(removals.map((r) => r.spaceId)))}
                >
                  {unfollowCount === removals.length ? "Uncheck all" : `Check all ${removals.length}`}
                </button>
              )}
              <ul className="import-names import-removal-list">
                {removals.map((r) => (
                  <li key={r.spaceId}>
                    <label className="import-name import-removal">
                      <input
                        type="checkbox"
                        checked={unfollow.has(r.spaceId)}
                        onChange={(e) => {
                          const next = new Set(unfollow);
                          if (e.currentTarget.checked) next.add(r.spaceId);
                          else next.delete(r.spaceId);
                          setUnfollow(next);
                        }}
                      />
                      <SourceIcon name={r.name} iconUrl={r.iconUrl} />
                      <span>
                        <span className="import-name-text">{r.name}</span>
                        <span className="import-name-handle"> {r.address}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {shown.removals === null && (
            <p className="panel-text" data-testid="import-removals-unknown">
              {shown.incomplete
                ? `Bluesky didn't send all of ${importWho(shown)}'s follows just now, so the River can't tell whom it stopped following. Nobody is unfollowed; try again later to check.`
                : `${importWho(shown)} follows more than 1,000 accounts, so the River can't tell whom it stopped following. Nobody is unfollowed.`}
            </p>
          )}

          {(shown.count > 0 || removals.length > 0) && (
            <div className="follow-confirm">
              {shown.count > 0 && circles.length > 0 && (
                <fieldset className="circle-picker">
                  <legend>Add them to a circle</legend>
                  <ul className="chip-list">
                    {[{ id: "", name: "No circle", color: null }, ...circles].map((c) => (
                      <li key={c.id || "none"}>
                        <label className="chip chip-radio">
                          <input
                            type="radio"
                            name={circleName}
                            value={c.id}
                            checked={circleId === c.id}
                            onChange={() => setCircleId(c.id)}
                          />
                          {c.id && <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />}
                          {c.name}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
              <button
                type="button"
                className="button button-primary"
                onClick={importAll}
                disabled={state.step === "importing" || (shown.count === 0 && unfollowCount === 0)}
              >
                {state.step === "importing" ? (shown.count > 0 ? "Following…" : "Unfollowing…") : importButtonLabel(shown.count, unfollowCount)}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
