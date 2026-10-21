// The follow box (spec F6, members): one field for a URL or @name@server. "Look it up" asks the
// River to resolve it (adapters and fetch guard on the server) and shows the preview: name, icon
// or initials, kind. A URL that points at one hub process offers "Just this stream" or "The whole
// space". The member picks circles and confirms; the River stores the follow and refreshes the
// space, and the feed shows its items. Errors are the server's F6 sentences, shown as they come.
import { useId, useState } from "react";
import { circleColor } from "../lib/format";
import { confirmFollow, previewFollow, type CircleView, type Preview } from "../lib/following";
import { SourceIcon } from "./SourceIcon";

export const STREAM_CHOICE = "Just this stream (ends on its own when the process ends)";
export const SPACE_CHOICE = "The whole space";

type State =
  | { step: "idle" }
  | { step: "looking" }
  | { step: "preview"; input: string; preview: Preview }
  | { step: "following"; input: string; preview: Preview }
  | { step: "done"; name: string };

function swatch(color: string | null): React.CSSProperties | undefined {
  const value = circleColor(color);
  return value ? ({ "--circle-color": value } as React.CSSProperties) : undefined;
}

export function FollowBox({
  circles,
  onFollowed,
  inputId = "follow-input",
}: {
  circles: CircleView[];
  /** Called after a follow is stored and its space refreshed. */
  onFollowed: () => void;
  inputId?: string;
}) {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<"stream" | "space">("stream");
  const [chosen, setChosen] = useState<string[]>([]);
  const headingId = useId();
  const hintId = useId();
  const scopeName = useId();

  const lookUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = text.trim();
    if (!input) {
      setError("Paste a web address or a handle like @name@server.");
      return;
    }
    setError(null);
    setState({ step: "looking" });
    const result = await previewFollow(input);
    if (!result.ok) {
      setState({ step: "idle" });
      setError(result.message);
      return;
    }
    setScope(result.value.preview.stream ? "stream" : "space");
    setChosen([]);
    setState({ step: "preview", input, preview: result.value.preview });
  };

  const follow = async () => {
    if (state.step !== "preview") return;
    const { input, preview } = state;
    setState({ step: "following", input, preview });
    setError(null);
    const result = await confirmFollow(input, preview.stream ? scope : "space", chosen);
    if (!result.ok) {
      setState({ step: "preview", input, preview });
      setError(result.message);
      return;
    }
    const name = preview.stream && scope === "stream" ? (preview.stream.title ?? `a stream of ${preview.name}`) : preview.name;
    setState({ step: "done", name });
    setText("");
    onFollowed();
  };

  const shown = state.step === "preview" || state.step === "following" ? state.preview : undefined;

  return (
    <section className="panel follow-box" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel-title">
        Follow something
      </h2>
      <p className="panel-text" id={hintId}>
        Paste the web address of a space, a stream, a feed or a podcast, or a handle like @name@server.
      </p>
      <form className="follow-form" onSubmit={lookUp}>
        <label className="visually-hidden" htmlFor={inputId}>
          Web address or handle
        </label>
        <input
          id={inputId}
          className="text-input follow-input"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          maxLength={500}
          placeholder="floyd.civic.social or @name@server"
          aria-describedby={hintId}
          value={text}
          onChange={(e) => {
            setText(e.currentTarget.value);
            if (state.step === "done") setState({ step: "idle" });
          }}
        />
        <button type="submit" className="button button-primary" disabled={state.step === "looking"}>
          {state.step === "looking" ? "Looking…" : "Look it up"}
        </button>
      </form>

      {error && (
        <p className="follow-error" role="alert">
          {error}
        </p>
      )}
      {state.step === "done" && (
        <p className="follow-done" role="status">
          You're following {state.name}. Its items are in your River.
        </p>
      )}

      {shown && (
        <div className="follow-preview" data-testid="follow-preview">
          <div className="follow-preview-head">
            <SourceIcon name={shown.name} iconUrl={shown.iconUrl} />
            <div>
              <p className="follow-preview-name">{shown.name}</p>
              <p className="follow-preview-meta">
                {shown.kind} · {shown.address}
                {shown.stream && ` · this link is one stream${shown.stream.title ? `: ${shown.stream.title}` : ""}`}
              </p>
            </div>
          </div>

          {shown.stream && (
            <fieldset className="follow-scope">
              <legend>What do you want to follow?</legend>
              <label className="radio">
                <input
                  type="radio"
                  name={scopeName}
                  value="stream"
                  checked={scope === "stream"}
                  onChange={() => setScope("stream")}
                />
                {STREAM_CHOICE}
              </label>
              <label className="radio">
                <input
                  type="radio"
                  name={scopeName}
                  value="space"
                  checked={scope === "space"}
                  onChange={() => setScope("space")}
                />
                {SPACE_CHOICE}
              </label>
            </fieldset>
          )}

          <div className="follow-confirm">
            {circles.length > 0 && (
              <fieldset className="circle-picker">
                <legend>Circles</legend>
                <ul className="chip-list">
                  {circles.map((c) => {
                    const on = chosen.includes(c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="chip"
                          aria-pressed={on}
                          onClick={() => setChosen((cur) => (on ? cur.filter((id) => id !== c.id) : [...cur, c.id]))}
                        >
                          <span className="circle-swatch" style={swatch(c.color)} aria-hidden="true" />
                          {c.name}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            )}
            <button
              type="button"
              className="button button-primary"
              onClick={follow}
              disabled={state.step === "following"}
            >
              {state.step === "following" ? "Following…" : "Follow"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
