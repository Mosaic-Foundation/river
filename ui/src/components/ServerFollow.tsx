// "Follow as @ana@example.social" on a fediverse space's Following row (fediverse-posting-1.md item
// 2.2; ADR-010 §3): following the space's account on the member's own server, separate from
// following the space in the River (neither does the other). A disclosure, so the member's server
// is asked about the relationship only when they open it: one row per linked account, each with
// Follow, Unfollow, or Requested for a locked account (a click cancels the request).
import { useId, useState } from "react";
import { firstToggleNote, followLabel, followSpace, loadRelationship, type Relationship } from "../lib/toggles";

export interface ServerFollowAccount {
  id: string;
  handle: string;
}

type RowState =
  | { status: "loading" }
  | { status: "ready"; relationship: Relationship; busy: boolean; message: { text: string; alert: boolean } | null }
  | { status: "error"; message: string };

export function ServerFollow({ spaceId, spaceName, accounts }: { spaceId: string; spaceName: string; accounts: readonly ServerFollowAccount[] }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const panelId = useId();

  const load = () => {
    setRows(Object.fromEntries(accounts.map((a) => [a.id, { status: "loading" } as RowState])));
    for (const account of accounts) {
      void loadRelationship(account.id, spaceId).then((answer) =>
        setRows((r) => ({
          ...r,
          [account.id]: answer.ok
            ? { status: "ready", relationship: answer.body, busy: false, message: null }
            : { status: "error", message: answer.refusal.message },
        })),
      );
    }
  };

  const act = (account: ServerFollowAccount, relationship: Relationship) => {
    const verb = relationship.following || relationship.requested ? "unfollow" : "follow";
    setRows((r) => ({ ...r, [account.id]: { status: "ready", relationship, busy: true, message: null } }));
    void followSpace(account.id, spaceId, verb).then((answer) => {
      setRows((r) => {
        if (!answer.ok) return { ...r, [account.id]: { status: "ready", relationship, busy: false, message: { text: answer.refusal.message, alert: true } } };
        const result = answer.body;
        if (result.status !== "sent") {
          return { ...r, [account.id]: { status: "ready", relationship, busy: false, message: { text: result.message, alert: result.status === "failed" } } };
        }
        const next = { following: result.on === true, requested: result.requested };
        const text = result.firstToggle ? `${result.message}. ${firstToggleNote(account.handle)}` : result.message;
        return { ...r, [account.id]: { status: "ready", relationship: next, busy: false, message: { text, alert: false } } };
      });
    });
  };

  return (
    <div className="server-follow">
      <button
        type="button"
        className="button button-small button-quiet"
        aria-expanded={open}
        aria-controls={panelId}
        data-testid="server-follow-toggle"
        onClick={() => {
          if (!open) load();
          setOpen((v) => !v);
        }}
      >
        On the fediverse<span className="visually-hidden">: follow {spaceName} as your linked account</span>
      </button>
      {open && (
        <ul className="server-follow-list" id={panelId} aria-label={`Follow ${spaceName} on the fediverse`}>
          {accounts.map((account) => {
            const row = rows[account.id] ?? { status: "loading" };
            return (
              <li key={account.id} className="server-follow-row" data-testid="server-follow-row">
                <span className="server-follow-handle">{account.handle}</span>
                {row.status === "loading" && <span className="space-row-meta">Checking…</span>}
                {row.status === "error" && (
                  <span className="follow-error" role="alert">
                    {row.message}
                  </span>
                )}
                {row.status === "ready" && (
                  <>
                    <button
                      type="button"
                      className="button button-small button-secondary"
                      aria-pressed={row.relationship.following || row.relationship.requested}
                      disabled={row.busy}
                      data-testid="server-follow-button"
                      aria-label={
                        row.relationship.requested
                          ? `Requested: cancel the request to follow ${spaceName} as ${account.handle}`
                          : `${followLabel(row.relationship)} ${spaceName} as ${account.handle}`
                      }
                      onClick={() => act(account, row.relationship)}
                    >
                      {followLabel(row.relationship)}
                    </button>
                    {row.message?.alert && (
                      <span className="follow-error" role="alert">
                        {row.message.text}
                      </span>
                    )}
                    {/* Always present, so a screen reader hears the words when they arrive. */}
                    <span className={row.message && !row.message.alert ? "space-row-meta" : "visually-hidden"} role="status">
                      {row.message && !row.message.alert ? row.message.text : null}
                    </span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
