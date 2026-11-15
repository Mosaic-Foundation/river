// Undo, on a boost, favourite or follow in Your activity (fediverse-posting-1.md item 4; ADR-010
// §8): one click, since the original is on screen. The server sends the opposite request and the
// original then reads Undone.
import { useState } from "react";
import type { ActivityEntry } from "../lib/activity";
import { undoAct, undoLabel } from "../lib/toggles";

export function UndoControl({ entry, onUndone }: { entry: ActivityEntry; onUndone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <p className="activity-meta">
      <button
        type="button"
        className="card-action"
        disabled={busy}
        data-testid="activity-undo"
        onClick={() => {
          setBusy(true);
          setError(null);
          void undoAct(entry.id).then((answer) => {
            setBusy(false);
            if (!answer.ok) setError(answer.refusal.message);
            else if (answer.body.status !== "sent") setError(answer.body.message);
            else onUndone(answer.body.message);
          });
        }}
      >
        {busy ? "Undoing…" : undoLabel(entry.verb)}
      </button>
      {error && (
        <span className="follow-error" role="alert">
          {" "}
          {error}
        </span>
      )}
    </p>
  );
}
