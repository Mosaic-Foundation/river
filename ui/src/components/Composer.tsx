// The composer (fediverse-posting-1.md item 3; ADR-010 §4, §9): write a post or a reply as a linked
// fediverse account, preview exactly what will be sent, then Send. A modal <dialog>: focus stays
// inside, Escape closes, and focus goes back to the control that opened it.
//
//   write    account (when several), the post being answered, an optional content warning, the
//            text with its counter (red and Preview disabled over the server's limit), visibility
//   preview  as followers will see it, and under "Show exactly what will be sent" the request
//   result   Posted with View ↗; or the failure beside Send with the text kept; or "We couldn't
//            tell" with Check on ↗ and, while it is safe, Try again
//
// Text from servers and the member is shown as text, never as markup.
import { useEffect, useId, useRef, useState } from "react";
import {
  characterCount,
  loadCompose,
  previewPost,
  refusalText,
  replyStart,
  requestText,
  retryPost,
  sendPost,
  VISIBILITY_LABELS,
  type ComposeAccount,
  type ComposeInfo,
  type Preview,
  type SendResult,
  type Visibility,
} from "../lib/compose";

export interface ComposerProps {
  /** The control that opened the composer; null when closed. */
  trigger: HTMLElement | null;
  /** The River item being answered, for a reply. */
  replyToItemId: string | null;
  onClose: () => void;
}

type Step =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "write" }
  | { kind: "preview"; preview: Preview }
  | { kind: "done"; result: SendResult };

export function Composer({ trigger, replyToItemId, onClose }: ComposerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const ids = { title: useId(), text: useId(), counter: useId(), warning: useId(), visibility: useId(), account: useId() };
  const open = trigger !== null;

  const [info, setInfo] = useState<ComposeInfo | null>(null);
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [accountId, setAccountId] = useState("");
  const [text, setText] = useState("");
  const [warningOpen, setWarningOpen] = useState(false);
  const [warning, setWarning] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Each opening is a fresh mount (River.tsx keys it), so this loads the server's facts once.
  useEffect(() => {
    if (!open) return;
    let live = true;
    void loadCompose(replyToItemId ?? undefined).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        setStep({ kind: "error", message: answer.refusal.message });
        return;
      }
      const { accounts, replyTo } = answer.body;
      if (accounts.length === 0) {
        setStep({ kind: "error", message: "Link a fediverse account first, in Settings → Linked accounts." });
        return;
      }
      const first = accounts[0] as ComposeAccount;
      setInfo(answer.body);
      setAccountId(first.id);
      setVisibility(first.defaultVisibility);
      setText(replyStart(replyTo));
      setWarning(replyTo?.spoilerText ?? "");
      setWarningOpen(Boolean(replyTo?.spoilerText));
      setStep({ kind: "write" });
    });
    return () => {
      live = false;
    };
  }, [open, replyToItemId]);

  useEffect(() => {
    if (step.kind === "write") textRef.current?.focus();
    if (step.kind === "preview") sendRef.current?.focus();
  }, [step.kind]);

  const account = info?.accounts.find((a) => a.id === accountId);
  const count = account ? characterCount(text, warningOpen ? warning : "", account) : 0;
  const max = account?.limits.maxCharacters ?? 500;
  const over = count > max;
  const empty = text.trim() === "";
  const replyTo = info?.replyTo ?? null;

  const close = () => ref.current?.close();

  const preview = async () => {
    if (!account || over || empty) return;
    setBusy(true);
    setError(null);
    const answer = await previewPost({
      linkedAccountId: account.id,
      text,
      spoilerText: warningOpen ? warning : "",
      visibility,
      language: account.defaultLanguage,
      replyToItemId: replyTo?.itemId ?? null,
    });
    setBusy(false);
    if (answer.ok) setStep({ kind: "preview", preview: answer.body });
    else setError(refusalText(answer.refusal));
  };

  const send = async (how: "send" | "retry", id: string) => {
    setBusy(true);
    setError(null);
    const answer = how === "send" ? await sendPost(id) : await retryPost(id);
    setBusy(false);
    if (!answer.ok) {
      setError(refusalText(answer.refusal));
      // A preview that can't be sent any more goes back to writing, with the text kept.
      if (["preview_expired", "already_sent", "session_ended", "signed_out"].includes(answer.refusal.error)) setStep({ kind: "write" });
      return;
    }
    const result = answer.body;
    if (result.status === "failed") {
      // A failed post keeps its text in the composer (ADR-010 §9); the error shows beside Send.
      setError(refusalText({ error: result.error ?? "failed", message: result.message, retryAt: result.retryAt }));
      setStep({ kind: "write" });
      return;
    }
    setStep({ kind: "done", result });
  };

  return (
    <dialog
      ref={ref}
      className="info-dialog composer"
      aria-labelledby={ids.title}
      data-testid="composer"
      onClose={() => {
        onClose();
        trigger?.focus();
      }}
    >
      <div className="info-dialog-body composer-body">
        <h2 id={ids.title} className="info-dialog-title">
          {replyToItemId ? "Reply" : "New post"}
        </h2>

        {step.kind === "loading" && <p role="status">Loading…</p>}
        {step.kind === "error" && (
          <p className="follow-error" role="alert">
            {step.message}
          </p>
        )}

        {step.kind === "write" && account && info && (
          <form
            className="composer-form"
            onSubmit={(e) => {
              e.preventDefault();
              void preview();
            }}
          >
            {info.accounts.length > 1 ? (
              <p className="composer-field">
                <label htmlFor={ids.account}>Post as</label>
                <select
                  id={ids.account}
                  className="text-input"
                  value={accountId}
                  onChange={(e) => {
                    const next = info.accounts.find((a) => a.id === e.currentTarget.value);
                    setAccountId(e.currentTarget.value);
                    if (next) setVisibility(next.defaultVisibility);
                  }}
                >
                  {info.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.handle}
                    </option>
                  ))}
                </select>
              </p>
            ) : (
              <p className="panel-text">as {account.handle}</p>
            )}

            {replyTo && (
              <blockquote className="composer-quote" data-testid="composer-quote">
                <p className="panel-text">Replying to</p>
                <p>{replyTo.title}</p>
              </blockquote>
            )}

            {warningOpen ? (
              <p className="composer-field">
                <label htmlFor={ids.warning}>Content warning</label>
                <input
                  id={ids.warning}
                  className="text-input"
                  value={warning}
                  maxLength={2000}
                  onChange={(e) => setWarning(e.currentTarget.value)}
                />
              </p>
            ) : (
              <p>
                <button type="button" className="card-action" onClick={() => setWarningOpen(true)}>
                  Add a content warning
                </button>
              </p>
            )}

            <p className="composer-field">
              <label htmlFor={ids.text}>{replyToItemId ? "Your reply" : "Your post"}</label>
              <textarea
                ref={textRef}
                id={ids.text}
                className="text-input composer-text"
                rows={6}
                value={text}
                aria-describedby={ids.counter}
                aria-invalid={over || undefined}
                onChange={(e) => setText(e.currentTarget.value)}
              />
              <span id={ids.counter} className={over ? "composer-counter composer-over" : "composer-counter"} data-testid="composer-counter">
                {count} / {max}
                {over && " (too long)"}
              </span>
            </p>

            <p className="composer-field">
              <label htmlFor={ids.visibility}>Visibility</label>
              <select
                id={ids.visibility}
                className="text-input"
                value={visibility}
                onChange={(e) => setVisibility(e.currentTarget.value as Visibility)}
              >
                {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                  <option key={v} value={v}>
                    {VISIBILITY_LABELS[v]}
                  </option>
                ))}
              </select>
            </p>

            {error && (
              <p className="follow-error" role="alert" data-testid="composer-error">
                {error}
              </p>
            )}
            <p className="account-actions">
              <button type="submit" className="button button-primary" disabled={busy || over || empty}>
                {busy ? "Checking…" : "Preview"}
              </button>
              <button type="button" className="button button-quiet" onClick={close}>
                Cancel
              </button>
            </p>
          </form>
        )}

        {step.kind === "preview" && (
          <div className="composer-preview" data-testid="composer-preview">
            <p className="panel-text">
              As followers will see it, from {step.preview.as} on {step.preview.server} ·{" "}
              {VISIBILITY_LABELS[step.preview.request.body.visibility]}
            </p>
            {step.preview.replyTo && <p className="panel-text">In reply to: {step.preview.replyTo.title}</p>}
            <div className="composer-post">
              {step.preview.request.body.spoiler_text && (
                <p>
                  <strong>CW: {step.preview.request.body.spoiler_text}</strong>
                </p>
              )}
              <p className="composer-post-text">{step.preview.request.body.status}</p>
            </div>
            <details>
              <summary>Show exactly what will be sent</summary>
              <pre className="composer-request" data-testid="composer-request">
                {requestText(step.preview.request)}
              </pre>
            </details>
            {error && (
              <p className="follow-error" role="alert" data-testid="composer-error">
                {error}
              </p>
            )}
            <p className="account-actions">
              <button
                ref={sendRef}
                type="button"
                className="button button-primary"
                disabled={busy}
                onClick={() => void send("send", step.preview.id)}
              >
                {busy ? "Sending…" : "Send"}
              </button>
              <button type="button" className="button button-quiet" disabled={busy} onClick={() => setStep({ kind: "write" })}>
                Edit
              </button>
            </p>
          </div>
        )}

        {step.kind === "done" && (
          <div className="composer-done" data-testid="composer-done">
            {step.result.status === "sent" ? (
              <p role="status">
                {step.result.message}
                {step.result.remoteUrl && (
                  <>
                    {" · "}
                    <a href={step.result.remoteUrl} target="_blank" rel="noopener noreferrer">
                      View ↗
                    </a>
                  </>
                )}
              </p>
            ) : (
              <>
                <p role="alert">{step.result.message}</p>
                <p className="account-actions">
                  <a className="button button-secondary" href={step.result.checkUrl} target="_blank" rel="noopener noreferrer">
                    Check on {new URL(step.result.checkUrl).host} ↗
                  </a>
                  {step.result.canRetry && (
                    <button type="button" className="button button-primary" disabled={busy} onClick={() => void send("retry", step.result.id)}>
                      {busy ? "Trying…" : "Try again"}
                    </button>
                  )}
                </p>
              </>
            )}
            {error && (
              <p className="follow-error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {(step.kind === "done" || step.kind === "error" || step.kind === "loading") && (
          <button type="button" className="button button-primary" onClick={close}>
            Done
          </button>
        )}
      </div>
    </dialog>
  );
}
