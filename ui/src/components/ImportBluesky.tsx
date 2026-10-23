// "Import from Bluesky" on the Follow screen (docs/spec/bluesky-1.md item 4, members). The member
// types a Bluesky handle; the River lists the accounts it follows (getFollows, on the server) and
// shows who, how many and the first names. The member chooses a circle (or none) and follows them
// all. Their posts fill in over the next opens of the River: each open refreshes a few (DECISIONS.md
// "Refreshing hundreds of Bluesky accounts"). Errors are the server's F6 sentences.
import { useId, useState } from "react";
import { circleColor } from "../lib/format";
import {
  importBluesky,
  importCountSentence,
  importDoneSentence,
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
    setState({ step: "preview", input, preview: result.value });
  };

  const importAll = async () => {
    if (state.step !== "preview") return;
    const { input, preview } = state;
    setState({ step: "importing", input, preview });
    setError(null);
    const result = await importBluesky(input, circleId ? [circleId] : []);
    if (!result.ok) {
      setState({ step: "preview", input, preview });
      setError(result.message);
      return;
    }
    const circle = circles.find((c) => c.id === circleId)?.name ?? null;
    setState({ step: "done", sentence: importDoneSentence(result.value, circle) });
    setText("");
    onImported();
  };

  const shown = state.step === "preview" || state.step === "importing" ? state.preview : undefined;

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

          {shown.count > 0 && (
            <div className="follow-confirm">
              {circles.length > 0 && (
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
                disabled={state.step === "importing"}
              >
                {state.step === "importing" ? "Following…" : `Follow all ${shown.count}`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
