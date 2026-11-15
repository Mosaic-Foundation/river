// Boost and Favourite on a live fediverse card (fediverse-posting-1.md items 2.1 and 4; ADR-010
// §3, §9): one click each, as the member's default linked account, named in each button's
// accessible name. The card starts from the River's own record; the first time the member points
// at or focuses a toggle, the member's server is asked for the post's real state (item 4's
// `reblogged` and `favourited`), and a click waits for that answer. A toggle changes at once and
// changes back, with the server's words, if it fails; an unknown outcome changes back too and says
// so. The first toggle on a link shows item 4's note. A boost card's toggles act on the boosted
// post (the server resolves it).
import { useEffect, useRef, useState } from "react";
import { firstToggleNote, loadStatusState, togglePost, toggleLabel, type StatusToggle } from "../lib/toggles";

export interface CardTogglesProps {
  itemId: string;
  account: { id: string; handle: string };
  boosted: boolean;
  favourited: boolean;
  /** Item 4's note was already shown for this link. */
  noteShown: boolean;
  /** A toggle went through: the River's record of this item changed. */
  onToggled: (itemId: string, kind: "boost" | "favourite", on: boolean) => void;
  onFirstToggle: (linkId: string) => void;
}

type Kind = "boost" | "favourite";
type State = Record<Kind, boolean>;

export function CardToggles({ itemId, account, boosted, favourited, noteShown, onToggled, onFirstToggle }: CardTogglesProps) {
  const [state, setState] = useState<State>({ boost: boosted, favourite: favourited });
  const [busy, setBusy] = useState<Kind | null>(null);
  const [message, setMessage] = useState<{ text: string; alert: boolean } | null>(null);
  const [note, setNote] = useState(false);
  // The server's answer, asked once; until it comes the River's own record stands.
  const checked = useRef<Promise<State | null> | null>(null);
  const known = useRef(false);

  // A later answer from the River's own record (more cards loaded) updates a card not yet checked.
  useEffect(() => {
    if (!known.current && busy === null) setState({ boost: boosted, favourite: favourited });
  }, [boosted, favourited, busy]);

  const check = (): Promise<State | null> => {
    checked.current ??= loadStatusState(account.id, itemId).then(
      (answer) => {
        if (!answer.ok) return null;
        const server = { boost: answer.body.reblogged, favourite: answer.body.favourited };
        known.current = true;
        setState(server);
        return server;
      },
      () => null,
    );
    return checked.current;
  };

  const flip = async (kind: Kind) => {
    setBusy(kind);
    setMessage(null);
    const server = await check();
    const was = server ? server[kind] : state[kind];
    const verb: StatusToggle = was ? (kind === "boost" ? "unboost" : "unfavourite") : kind;
    setState((s) => ({ ...s, [kind]: !was }));
    const answer = await togglePost(account.id, itemId, verb);
    setBusy(null);
    if (!answer.ok) {
      setState((s) => ({ ...s, [kind]: was }));
      setMessage({ text: answer.refusal.message, alert: true });
      return;
    }
    const result = answer.body;
    if (result.status !== "sent") {
      setState((s) => ({ ...s, [kind]: was }));
      setMessage({ text: result.message, alert: result.status === "failed" });
      return;
    }
    const on = result.on ?? !was;
    known.current = true;
    setState((s) => ({ ...s, [kind]: on }));
    onToggled(itemId, kind, on);
    if (result.firstToggle && !noteShown) {
      setNote(true);
      onFirstToggle(account.id);
    }
  };

  const button = (kind: Kind) => (
    <button
      type="button"
      className="button button-secondary card-toggle"
      aria-pressed={state[kind]}
      disabled={busy !== null}
      data-testid={`card-${kind}`}
      onPointerEnter={() => void check()}
      onFocus={() => void check()}
      onClick={() => void flip(kind)}
    >
      {toggleLabel(kind, state[kind])}
      <span className="visually-hidden"> as {account.handle}</span>
    </button>
  );

  const alert = message?.alert ? message.text : null;
  const status = alert ? null : (message?.text ?? (note ? firstToggleNote(account.handle) : null));
  return (
    <>
      {button("boost")}
      {button("favourite")}
      {alert && (
        <p className="card-toggle-message" role="alert" data-testid="card-toggle-message">
          {alert}
        </p>
      )}
      {/* Always present, so a screen reader hears the words when they arrive. */}
      <p className={status ? "card-toggle-message" : "visually-hidden"} role="status" data-testid={status ? "card-toggle-message" : undefined}>
        {status}
      </p>
    </>
  );
}
