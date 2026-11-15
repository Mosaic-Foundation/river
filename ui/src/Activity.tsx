// Your activity at /activity (ADR-010 §7): everything the River sent in the member's name, newest
// first, with how it went and a link to it. A post or reply sent from the River can be deleted
// here (fediverse-posting-1 item 2.4); the other undos come with their acts (A4, B3). Members only; a visitor gets the sign-up prompt. Every value from the other
// side is shown as text; links are https only (the API drops the rest).
import { useCallback, useEffect, useState } from "react";
import { DeleteControl } from "./components/DeleteControl";
import { signOut, type Viewer } from "./lib/api";
import { canDelete, deletePost, loadActivity, statusText, targetText, verbLabel, type ActivityEntry } from "./lib/activity";
import { fullDateTime, relativeTime } from "./lib/format";
import { modeFromSearch, themeForMode, withMode } from "./lib/modes";
import { Brand } from "./components/Chrome";
import { ProfileMenu } from "./components/ProfileMenu";
import { SignUpPrompt } from "./Following";

type State =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "error" }
  | { status: "ok"; viewer: Viewer; entries: ActivityEntry[]; nextCursor: string | null; more: "idle" | "loading" | "error" };

function Entry({ entry, onDeleted }: { entry: ActivityEntry; onDeleted: (message: string) => void }) {
  return (
    <li className={`activity-entry activity-${entry.status}`} data-testid="activity-entry">
      <p className="activity-what">
        <strong>{verbLabel(entry.verb)}</strong> {targetText(entry)}
        {entry.subjectTitle &&
          (entry.subjectUrl ? (
            <>
              {" · "}
              <a href={entry.subjectUrl} target="_blank" rel="noopener noreferrer">
                {entry.subjectTitle}
              </a>
            </>
          ) : (
            <> · {entry.subjectTitle}</>
          ))}
      </p>
      <p className="activity-meta">
        <time dateTime={entry.at} title={fullDateTime(entry.at)}>
          {relativeTime(entry.at)}
        </time>
        {" · "}
        <span className="activity-status">{statusText(entry)}</span>
        {entry.remoteUrl && entry.status !== "undone" && (
          <>
            {" · "}
            <a href={entry.remoteUrl} target="_blank" rel="noopener noreferrer">
              View ↗
            </a>
          </>
        )}
      </p>
      {canDelete(entry) && <DeleteControl entry={entry} remove={deletePost} onDeleted={onDeleted} />}
    </li>
  );
}

export function ActivityPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const mode = modeFromSearch(window.location.search);

  useEffect(() => {
    document.title = "Your activity · Mosaic River";
    document.documentElement.dataset.theme = themeForMode(mode);
  }, [mode]);

  // The first page; state is set only when it answers (a retry sets "loading" first, in its click).
  const fetchFirst = useCallback((signal?: AbortSignal) => {
    loadActivity(undefined, signal).then(
      (result) => setState(result.status === "ok" ? { ...result, more: "idle" } : result),
      () => undefined,
    );
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchFirst(controller.signal);
    return () => controller.abort();
  }, [fetchFirst]);

  const retry = () => {
    setState({ status: "loading" });
    fetchFirst();
  };

  const loadMore = () => {
    if (state.status !== "ok" || !state.nextCursor) return;
    setState({ ...state, more: "loading" });
    void loadActivity(state.nextCursor).then((result) =>
      setState((current) =>
        current.status !== "ok"
          ? current
          : result.status === "ok"
            ? { ...current, entries: [...current.entries, ...result.entries], nextCursor: result.nextCursor, more: "idle" }
            : { ...current, more: "error" },
      ),
    );
  };

  return (
    <div className="page following-page activity-page">
      <a className="skip-link" href="#activity">
        Skip to Your activity
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
              onSignOut={(everywhere) => void signOut(everywhere).then(() => window.location.assign(withMode("/", mode)))}
            />
          )}
        </div>
      </header>
      <main className="following-main activity-main" id="activity" tabIndex={-1}>
        <h1 className="following-title">Your activity</h1>
        <p className="following-intro">
          Everything the River has sent in your name, newest first, for a year. If you see something you didn't send,
          use Sign out everywhere in the profile menu.
        </p>
        {notice && (
          <p className="panel-note link-notice" role="status" data-testid="activity-notice">
            {notice}
          </p>
        )}
        {state.status === "loading" && (
          <p className="feed-status" role="status">
            Loading your activity…
          </p>
        )}
        {state.status === "signed_out" && (
          <SignUpPrompt text="Posting, replying and acting at spaces from the River come with an account. You get a Mosaic ID with a passkey; no password." />
        )}
        {state.status === "error" && (
          <div className="feed-status" role="alert">
            <p>Your activity didn't load.</p>
            <button type="button" className="button button-primary" onClick={retry}>
              Try again
            </button>
          </div>
        )}
        {state.status === "ok" &&
          (state.entries.length === 0 ? (
            <p className="panel activity-empty" data-testid="activity-empty">
              Nothing yet. When you post, reply, boost or act at a space from the River, it shows here.
            </p>
          ) : (
            <>
              <ol className="activity-list" aria-label="Your activity, newest first">
                {state.entries.map((entry) => (
                  <Entry
                    key={entry.id}
                    entry={entry}
                    onDeleted={(message) => {
                      setNotice(message);
                      fetchFirst();
                    }}
                  />
                ))}
              </ol>
              {state.nextCursor && (
                <p className="activity-more">
                  <button type="button" className="button button-secondary" disabled={state.more === "loading"} onClick={loadMore}>
                    {state.more === "loading" ? "Loading…" : "Show older"}
                  </button>
                  {state.more === "error" && (
                    <span role="alert" className="card-muted">
                      {" "}
                      That didn't load. Try again.
                    </span>
                  )}
                </p>
              )}
            </>
          ))}
      </main>
    </div>
  );
}
