// The Following page at /following (spec F6, F7, F8; docs/design/mockups/following.png): the follow
// box and the Spaces, Quiet and Ended lists in the main column, circles beside them. Members only;
// a visitor gets the sign-up prompt. On a phone the same parts live in the River's Following and
// Circles tabs (River.tsx); this page works at that width too.
import { useEffect } from "react";
import { SIGN_IN_URL, signOut } from "./lib/api";
import { modeFromSearch, themeForMode, withMode } from "./lib/modes";
import { Brand } from "./components/Chrome";
import { CirclesPanel } from "./components/CirclesPanel";
import { ImportBluesky } from "./components/ImportBluesky";
import { FollowBox } from "./components/FollowBox";
import { FollowingList } from "./components/FollowingList";
import { ProfileMenu } from "./components/ProfileMenu";
import { useFollowing } from "./components/useFollowing";

/** What a visitor sees where a member's Following page or circles would be (spec 2, Visitor). */
export function SignUpPrompt({ text }: { text: string }) {
  return (
    <div className="panel signup-prompt">
      <p>{text}</p>
      <p className="account-actions">
        <a className="button button-primary" href={SIGN_IN_URL}>
          Sign up
        </a>
        <a className="button button-secondary" href={SIGN_IN_URL}>
          Sign in
        </a>
      </p>
    </div>
  );
}

export function FollowingPage() {
  const { state, busy, run, reload } = useFollowing(true);
  // The River links here with its mode (`?mode=civic`): the page wears that mode's theme, and its
  // way back keeps the mode.
  const mode = modeFromSearch(window.location.search);

  useEffect(() => {
    document.title = "Following · Mosaic River";
    document.documentElement.dataset.theme = themeForMode(mode);
  }, [mode]);

  // /following#follow (the header's Follow button) puts the cursor in the follow box.
  useEffect(() => {
    if (state.status === "ok" && window.location.hash === "#follow") {
      document.getElementById("follow-input")?.focus();
    }
  }, [state.status]);

  return (
    <div className="page following-page">
      <a className="skip-link" href="#following">
        Skip to Following
      </a>
      <header className="topbar">
        <Brand />
        <div className="topbar-actions">
          <a className="button button-quiet" href={withMode("/", mode)}>
            ‹ Back to your River
          </a>
          {/* The River's profile menu (ui-revisions-9): a member's once the page loads, a visitor's
              when signed out. */}
          {(state.status === "ok" || (state.status === "error" && state.signedOut)) && (
            <ProfileMenu
              viewer={state.status === "ok" ? (state.page.viewer ?? { did: null, displayName: null }) : null}
              followingHref={withMode("/following", mode)}
              onSignOut={() => void signOut().then(() => window.location.assign(withMode("/", mode)))}
            />
          )}
        </div>
      </header>
      <div className="following-layout">
        <main className="following-main" id="following" tabIndex={-1}>
          <h1 className="following-title">Following</h1>
          <p className="following-intro">The spaces you follow, and the streams inside them. Streams merge into your River.</p>
          {state.status === "loading" && (
            <p className="feed-status" role="status">
              Loading what you follow…
            </p>
          )}
          {state.status === "error" &&
            (state.signedOut ? (
              <SignUpPrompt text="Following Civic Hubs, fediverse accounts and single streams comes with an account. You get a Mosaic ID with a passkey; no password." />
            ) : (
              <div className="feed-status" role="alert">
                <p>{state.message}</p>
                <button type="button" className="button button-primary" onClick={reload}>
                  Try again
                </button>
              </div>
            ))}
          {state.status === "ok" && (
            <>
              <FollowBox circles={state.page.circles} onFollowed={reload} />
              <ImportBluesky circles={state.page.circles} onImported={reload} />
              <FollowingList page={state.page} run={run} busy={busy} />
            </>
          )}
        </main>
        {state.status === "ok" && (
          <aside className="following-aside" aria-label="Circles">
            <CirclesPanel page={state.page} run={run} busy={busy} />
          </aside>
        )}
      </div>
    </div>
  );
}
