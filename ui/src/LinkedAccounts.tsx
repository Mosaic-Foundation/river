// Settings → Linked accounts at /linked-accounts (fediverse-posting-1.md item 1; ADR-010 §3, §6).
// A member links a Mastodon or GoToSocial account in three steps: type the handle and Check (the
// River finds the server), read what linking allows, then "Continue to {server}", which goes to
// the server's own page to approve. The server sends the browser back through the River's
// callback to this page with `?link={result}`. Each linked account shows what the River can do
// with it and Unlink. Members only; a visitor gets the sign-up prompt. Everything from a server is
// shown as text.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { signOut, type Viewer } from "./lib/api";
import { fullDateTime, relativeTime } from "./lib/format";
import {
  checkAccount,
  explainer,
  linkResultMessage,
  loadLinkedAccounts,
  MAX_LINKED,
  startLink,
  statusNote,
  unlinkAccount,
  unlinkedMessage,
  VERBS_SENTENCE,
  type CheckedServer,
  type LinkedAccount,
} from "./lib/linkedAccounts";
import { modeFromSearch, themeForMode, withMode } from "./lib/modes";
import { Brand } from "./components/Chrome";
import { ProfileMenu } from "./components/ProfileMenu";
import { SignUpPrompt } from "./Following";

type State =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "error" }
  | { status: "ok"; viewer: Viewer; accounts: LinkedAccount[] };

type Notice = { text: string; ok: boolean } | null;

/** The callback's result from the address, read once; the address then loses it (keeping the mode). */
function takeLinkResult(): Notice {
  const params = new URLSearchParams(window.location.search);
  const notice = linkResultMessage(params.get("link")) ?? null;
  if (params.has("link")) {
    params.delete("link");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }
  return notice;
}

function AccountRow({ account, onUnlink, onRelink }: { account: LinkedAccount; onUnlink: (a: LinkedAccount) => Promise<void>; onRelink: (handle: string) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const note = statusNote(account);
  return (
    <li className="linked-account" data-testid="linked-account">
      <p className="linked-account-name">
        <strong>{account.displayName || account.handle}</strong>
        {account.displayName && <span className="linked-account-handle"> {account.handle}</span>}
      </p>
      <p className="activity-meta">
        {account.software ? `${account.software} · ` : ""}
        Linked{" "}
        <time dateTime={account.linkedAt} title={fullDateTime(account.linkedAt)}>
          {relativeTime(account.linkedAt)}
        </time>
        {" · "}
        {account.lastUsedAt ? (
          <>
            last used{" "}
            <time dateTime={account.lastUsedAt} title={fullDateTime(account.lastUsedAt)}>
              {relativeTime(account.lastUsedAt)}
            </time>
          </>
        ) : (
          "not used yet"
        )}
      </p>
      {account.status === "active" ? (
        <p className="panel-text">The River can {VERBS_SENTENCE} as this account.</p>
      ) : (
        <p className="linked-account-note" role="note">
          {note}{" "}
          <button type="button" className="button button-secondary button-small" onClick={() => onRelink(account.handle)}>
            Link it again
          </button>
        </p>
      )}
      {confirming ? (
        <div className="linked-account-confirm" role="group" aria-label={`Unlink ${account.handle}?`}>
          <p>
            Unlink {account.handle}? The River will ask {account.server} to forget its key, and forget it too.
          </p>
          <p className="account-actions">
            <button
              type="button"
              className="button button-primary button-small"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void onUnlink(account).finally(() => setBusy(false));
              }}
            >
              {busy ? "Unlinking…" : "Unlink"}
            </button>
            <button type="button" className="button button-quiet button-small" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </p>
        </div>
      ) : (
        <p>
          <button type="button" className="button button-secondary button-small" onClick={() => setConfirming(true)}>
            Unlink {account.handle}
          </button>
        </p>
      )}
    </li>
  );
}

function LinkForm({ input, setInput, inputRef }: { input: string; setInput: (v: string) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const inputId = useId();
  const hintId = useId();
  const [step, setStep] = useState<{ kind: "type" } | { kind: "checked"; server: CheckedServer; typed: string }>({ kind: "type" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const continueRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (step.kind === "checked") continueRef.current?.focus();
  }, [step]);

  const check = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await checkAccount(input);
    setBusy(false);
    if (result.ok) setStep({ kind: "checked", server: result.body, typed: input });
    else setError(result.message);
  };

  const go = async () => {
    if (step.kind !== "checked") return;
    setError(null);
    setBusy(true);
    const result = await startLink(step.typed);
    if (result.ok) {
      window.location.assign(result.body.authorizeUrl);
      return;
    }
    setBusy(false);
    setError(result.message);
  };

  const cancel = () => {
    setStep({ kind: "type" });
    setError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <section className="panel" aria-labelledby={`${inputId}-title`}>
      <h2 className="panel-title" id={`${inputId}-title`}>
        Link a fediverse account
      </h2>
      {step.kind === "type" ? (
        <form className="link-form" onSubmit={(e) => void check(e)}>
          <label htmlFor={inputId}>Your handle or profile address</label>
          <p className="panel-text" id={hintId}>
            A Mastodon (4.3 or later) or GoToSocial account, like @ana@example.social.
          </p>
          <div className="link-form-row">
            <input
              ref={inputRef}
              id={inputId}
              className="text-input"
              aria-describedby={hintId}
              autoComplete="off"
              spellCheck={false}
              maxLength={512}
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
            />
            <button type="submit" className="button button-primary" disabled={busy || input.trim() === ""}>
              {busy ? "Checking…" : "Check"}
            </button>
          </div>
        </form>
      ) : (
        <div className="link-explainer" data-testid="link-explainer">
          {explainer(step.server.handle).map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="panel-text">
            {step.server.server} runs {step.server.software}. You'll approve the link on {step.server.server}, then come back here.
          </p>
          <p className="account-actions">
            <button ref={continueRef} type="button" className="button button-primary" disabled={busy} onClick={() => void go()}>
              {busy ? "Opening…" : `Continue to ${step.server.server}`}
            </button>
            <button type="button" className="button button-quiet" disabled={busy} onClick={cancel}>
              Cancel
            </button>
          </p>
        </div>
      )}
      {error && (
        <p className="follow-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function LinkedAccountsPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [notice, setNotice] = useState<Notice>(() => takeLinkResult());
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mode = modeFromSearch(window.location.search);

  useEffect(() => {
    document.title = "Linked accounts · Mosaic River";
    document.documentElement.dataset.theme = themeForMode(mode);
  }, [mode]);

  const load = useCallback((signal?: AbortSignal) => {
    loadLinkedAccounts(signal).then(setState, () => undefined);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const onUnlink = async (account: LinkedAccount) => {
    const result = await unlinkAccount(account.id);
    setNotice(result.ok ? { ok: result.body.revokedThere, text: unlinkedMessage(result.body) } : { ok: false, text: result.message });
    load();
  };

  const onRelink = (handle: string) => {
    setInput(handle);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const active = state.status === "ok" ? state.accounts.filter((a) => a.status === "active").length : 0;

  return (
    <div className="page following-page linked-accounts-page">
      <a className="skip-link" href="#linked-accounts">
        Skip to Linked accounts
      </a>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <a className="button button-quiet" href={withMode("/", mode)}>
            ‹ Back to your River
          </a>
          {(state.status === "ok" || state.status === "signed_out") && (
            <ProfileMenu
              viewer={state.status === "ok" ? state.viewer : null}
              followingHref={withMode("/following", mode)}
              activityHref={withMode("/activity", mode)}
              linkedAccountsHref={withMode("/linked-accounts", mode)}
              onSignOut={(everywhere) => void signOut(everywhere).then(() => window.location.assign(withMode("/", mode)))}
            />
          )}
        </div>
      </header>
      <main className="following-main linked-accounts-main" id="linked-accounts" tabIndex={-1}>
        <h1 className="following-title">Linked accounts</h1>
        <p className="following-intro">
          Link your Mastodon or GoToSocial account to reply, boost, favourite and post from the River as that account.
          The River never shows you its key and never acts without your click.
        </p>
        {notice && (
          <p className={notice.ok ? "panel-note link-notice" : "follow-error link-notice"} role={notice.ok ? "status" : "alert"} data-testid="link-notice">
            {notice.text}
          </p>
        )}
        {state.status === "loading" && (
          <p className="feed-status" role="status">
            Loading your linked accounts…
          </p>
        )}
        {state.status === "signed_out" && (
          <SignUpPrompt text="Linking a fediverse account comes with a River account. You get a Mosaic ID with a passkey; no password." />
        )}
        {state.status === "error" && (
          <div className="feed-status" role="alert">
            <p>Your linked accounts didn't load.</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                setState({ status: "loading" });
                load();
              }}
            >
              Try again
            </button>
          </div>
        )}
        {state.status === "ok" && (
          <>
            {state.accounts.length === 0 ? (
              <p className="panel activity-empty" data-testid="linked-empty">
                No accounts linked yet.
              </p>
            ) : (
              <ul className="activity-list" aria-label="Your linked accounts">
                {state.accounts.map((account) => (
                  <AccountRow key={account.id} account={account} onUnlink={onUnlink} onRelink={onRelink} />
                ))}
              </ul>
            )}
            {active < MAX_LINKED ? (
              <LinkForm input={input} setInput={setInput} inputRef={inputRef} />
            ) : (
              <p className="panel-note">You've linked {MAX_LINKED} accounts, the most the River allows. Unlink one to link another.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
