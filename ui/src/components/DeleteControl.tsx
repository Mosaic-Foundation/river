// Delete, on a post or reply in Your activity (fediverse-posting-1.md items 2.4 and 4; ADR-010 §8):
// a button, then a confirmation in place that says what a delete can't promise.
import { useState } from "react";
import type { ActivityEntry, DeleteAnswer } from "../lib/activity";

export function DeleteControl({
  entry,
  remove,
  onDeleted,
}: {
  entry: ActivityEntry;
  remove: (id: string) => Promise<DeleteAnswer>;
  onDeleted: (message: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = entry.verb === "reply" ? "reply" : "post";

  if (!confirming) {
    return (
      <p className="activity-meta">
        <button type="button" className="card-action" onClick={() => setConfirming(true)}>
          Delete this {what}
        </button>
      </p>
    );
  }
  return (
    <div className="linked-account-confirm" role="group" aria-label={`Delete this ${what} on ${entry.targetHost}?`}>
      <p>
        Delete this {what} on {entry.targetHost}? Other servers are asked to delete their copies; some may keep them.
      </p>
      {error && (
        <p className="follow-error" role="alert">
          {error}
        </p>
      )}
      <p className="account-actions">
        <button
          type="button"
          className="button button-primary button-small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void remove(entry.id).then((answer) => {
              setBusy(false);
              if (answer.ok) onDeleted(answer.message);
              else setError(answer.message);
            });
          }}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button type="button" className="button button-quiet button-small" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </p>
    </div>
  );
}
