// The Following page's lists (spec F7, members): tabs Spaces, Quiet and Ended. Spaces are grouped
// by kind and collapsed; a hub space expands to its streams, each Following or Muted "until the
// process ends", or neither, with actions to mute, unmute, follow just that stream or stop. Quiet
// lists followed spaces with no new item in 90 days (never samples) and offers "Unfollow all quiet
// spaces"; Ended lists stream rules whose process ended, cleared after 90 days. Each followed row
// has a circles menu (ui-revisions-7) and a muted line saying where the follow came from (Adam,
// 2026-10-26), none for one from before origins were kept.
import { useId, useState } from "react";
import {
  groupSpaces,
  originLine,
  quietSentence,
  removeRule,
  setStreamRule,
  unfollowQuiet,
  unfollowSpace,
  type FollowingPage,
  type Result,
  type SpaceView,
  type StreamView,
} from "../lib/following";
import { CirclesMenu } from "./CirclesMenu";
import { SourceIcon } from "./SourceIcon";
import { useLocalRun, type Run as SharedRun } from "./useFollowing";

type TabId = "spaces" | "quiet" | "ended";

export const UNFOLLOW_QUIET = "Unfollow all quiet spaces";

const dateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

interface Actions {
  /** Runs a change, then reloads the page and the feed; shows the server's sentence on failure. */
  run: (change: () => Promise<Result<unknown>>) => Promise<boolean>;
  busy: boolean;
  /** The page's own run(), for the circles menu: it shows its own errors (ui-revisions-7). */
  save: SharedRun;
}

function StreamRow({ stream, actions }: { stream: StreamView; actions: Actions }) {
  const label = stream.rule === "follow" ? "Following" : stream.rule === "mute" ? "Muted" : null;
  return (
    <li className="stream-row" data-testid="stream-row" data-stream-key={stream.key}>
      <span className="stream-title">{stream.title}</span>
      {label && (
        <span className="stream-rule">
          <span className={stream.rule === "mute" ? "badge badge-muted" : "badge badge-following"}>{label}</span>
          <span className="stream-until">until the process ends</span>
        </span>
      )}
      <span className="stream-actions">
        {stream.rule === null && (
          <>
            <button
              type="button"
              className="button button-small button-secondary"
              disabled={actions.busy}
              aria-label={`Mute ${stream.title}`}
              onClick={() => actions.run(() => setStreamRule(stream.id, "mute"))}
            >
              Mute
            </button>
            <button
              type="button"
              className="button button-small button-quiet"
              disabled={actions.busy}
              aria-label={`Follow just ${stream.title}`}
              onClick={() => actions.run(() => setStreamRule(stream.id, "follow"))}
            >
              Follow just this
            </button>
          </>
        )}
        {stream.rule === "mute" && stream.ruleId && (
          <button
            type="button"
            className="button button-small button-secondary"
            disabled={actions.busy}
            aria-label={`Unmute ${stream.title}`}
            onClick={() => actions.run(() => removeRule(stream.ruleId!))}
          >
            Unmute
          </button>
        )}
        {stream.rule === "follow" && stream.ruleId && (
          <button
            type="button"
            className="button button-small button-secondary"
            disabled={actions.busy}
            aria-label={`Stop following ${stream.title}`}
            onClick={() => actions.run(() => removeRule(stream.ruleId!))}
          >
            Stop following
          </button>
        )}
      </span>
    </li>
  );
}

function SpaceRow({ space, page, actions }: { space: SpaceView; page: FollowingPage; actions: Actions }) {
  const [open, setOpen] = useState(false);
  const streamsId = useId();
  // Only a followed space can be in a circle (the API refuses the rest), as in the circle editor.
  const followed = space.following || space.streams.some((s) => s.rule === "follow");
  const ruled = space.streams.filter((s) => s.rule !== null).length;
  const origin = originLine(space.origin);
  return (
    <li className="space-row" data-testid="space-row" data-space-id={space.id}>
      <div className="space-row-main">
        <SourceIcon name={space.name} iconUrl={space.iconUrl} />
        <div className="space-row-text">
          <p className="space-row-name">{space.name}</p>
          <p className="space-row-meta">
            {space.following ? "Whole space" : "Streams only"} · {space.address}
          </p>
          {origin && (
            <p className="space-row-meta" data-testid="space-row-origin">
              {origin}
            </p>
          )}
          {space.lastError && <p className="space-row-error">{space.lastError}</p>}
        </div>
        {followed && <CirclesMenu space={space} circles={page.circles} run={actions.save} />}
        <div className="space-row-actions">
          {space.streams.length > 0 && (
            <button
              type="button"
              className="button button-small button-quiet"
              aria-expanded={open}
              aria-controls={streamsId}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide streams" : ruled > 0 ? `Streams (${ruled})` : "Streams"}
              <span className="visually-hidden"> of {space.name}</span>
            </button>
          )}
          <button
            type="button"
            className="button button-small button-secondary"
            disabled={actions.busy}
            aria-label={`Unfollow ${space.name}`}
            onClick={() => actions.run(() => unfollowSpace(space.id))}
          >
            Unfollow
          </button>
        </div>
      </div>
      {open && (
        <ul className="stream-list" id={streamsId} aria-label={`Streams of ${space.name}`}>
          {space.streams.map((s) => (
            <StreamRow key={s.id} stream={s} actions={actions} />
          ))}
        </ul>
      )}
    </li>
  );
}

function QuietBanner({ count, actions, onReview }: { count: number; actions: Actions; onReview?: () => void }) {
  return (
    <div className="quiet-banner" role="region" aria-label="Quiet spaces">
      <p>{quietSentence(count)} Tidy them up?</p>
      <div className="quiet-banner-actions">
        {onReview && (
          <button type="button" className="button button-small button-secondary" onClick={onReview}>
            Review
          </button>
        )}
        <button
          type="button"
          className="button button-small button-primary"
          disabled={actions.busy}
          onClick={() => actions.run(() => unfollowQuiet())}
        >
          {UNFOLLOW_QUIET}
        </button>
      </div>
    </div>
  );
}

export function FollowingList({ page, run: shared, busy }: { page: FollowingPage; run: SharedRun; busy: boolean }) {
  const { run, error } = useLocalRun(shared);
  const [tab, setTab] = useState<TabId>("spaces");
  const actions: Actions = { run, busy, save: shared };
  const quiet = page.spaces.filter((s) => page.quiet.includes(s.id));
  const tabs: Array<{ id: TabId; label: string; count: number }> = [
    { id: "spaces", label: "Spaces", count: page.spaces.length },
    { id: "quiet", label: "Quiet", count: quiet.length },
    { id: "ended", label: "Ended", count: page.ended.length },
  ];

  return (
    <section className="panel following-list" aria-label="What you follow">
      <div className="segmented" role="group" aria-label="Show">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className="segment"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label} · {t.count}
          </button>
        ))}
      </div>

      {error && (
        <p className="follow-error" role="alert">
          {error}
        </p>
      )}

      {tab === "spaces" && (
        <>
          {quiet.length > 0 && <QuietBanner count={quiet.length} actions={actions} onReview={() => setTab("quiet")} />}
          {page.spaces.length === 0 && <p className="panel-text">You don't follow any spaces yet.</p>}
          {groupSpaces(page.spaces).map((group) => (
            <div key={group.title} className="space-group">
              <h3 className="group-title">{group.title}</h3>
              <ul className="space-list">
                {group.spaces.map((s) => (
                  <SpaceRow key={s.id} space={s} page={page} actions={actions} />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {tab === "quiet" && (
        <>
          {quiet.length > 0 ? (
            <>
              <QuietBanner count={quiet.length} actions={actions} />
              <ul className="space-list">
                {quiet.map((s) => (
                  <SpaceRow key={s.id} space={s} page={page} actions={actions} />
                ))}
              </ul>
            </>
          ) : (
            <p className="panel-text">Every space you follow has posted in the last 90 days.</p>
          )}
        </>
      )}

      {tab === "ended" && (
        <>
          <p className="panel-text">Streams whose process ended. They're cleared 90 days after they end.</p>
          {page.ended.length === 0 ? (
            <p className="panel-text">Nothing has ended yet.</p>
          ) : (
            <ul className="space-list">
              {page.ended.map((e) => (
                <li key={e.ruleId} className="space-row" data-testid="ended-row" data-stream-key={e.stream.key}>
                  <div className="space-row-main">
                    <SourceIcon name={e.space.name} iconUrl={e.space.iconUrl} />
                    <div className="space-row-text">
                      <p className="space-row-name">{e.stream.title}</p>
                      <p className="space-row-meta">
                        {e.rule === "mute" ? "Muted" : "Followed"} · {e.space.name} · ended {formatDate(e.endedAt)}
                      </p>
                    </div>
                    <div className="space-row-actions">
                      <button
                        type="button"
                        className="button button-small button-secondary"
                        disabled={busy}
                        aria-label={`Remove ${e.stream.title}`}
                        onClick={() => run(() => removeRule(e.ruleId))}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <p className="panel-note">
        The most specific rule wins: a muted stream stays quiet inside a space you follow. Finished streams move to
        Ended; their final results stay in your River.
      </p>
    </section>
  );
}
