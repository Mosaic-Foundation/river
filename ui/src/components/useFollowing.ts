// Loads a member's Following page (spec F7, F8) and runs changes to it: each change goes to the
// API, then the page reloads (and the caller's onChanged reloads the feed), so what shows is what
// a reload would show. A refused change gives back the server's sentence, which the panel that
// made the change shows (useLocalRun).
import { useCallback, useEffect, useState } from "react";
import { loadFollowing, type FollowingPage, type Result } from "../lib/following";

export type FollowingState =
  | { status: "loading" }
  /** `signedOut`: the API answered 401 (a visitor, or a session that ended). */
  | { status: "error"; message: string; signedOut: boolean }
  | { status: "ok"; page: FollowingPage };

/** Runs a change; resolves true, or the sentence to show. */
export type Run = (change: () => Promise<Result<unknown>>) => Promise<true | string>;

export function useFollowing(enabled: boolean, onChanged?: () => void) {
  const [state, setState] = useState<FollowingState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadFollowing().then((result) => {
      if (!live) return;
      setState(
        result.ok
          ? { status: "ok", page: result.value }
          : { status: "error", message: result.message, signedOut: result.status === 401 },
      );
    });
    return () => {
      live = false;
    };
  }, [enabled, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const run: Run = useCallback(
    async (change) => {
      setBusy(true);
      const result = await change();
      setBusy(false);
      if (!result.ok) return result.message;
      reload();
      onChanged?.();
      return true;
    },
    [reload, onChanged],
  );

  return { state, busy, run, reload };
}

/** A panel's own view of run(): its last error, and a run that reports success as a boolean. */
export function useLocalRun(run: Run) {
  const [error, setError] = useState<string | null>(null);
  const local = useCallback(
    async (change: () => Promise<Result<unknown>>): Promise<boolean> => {
      setError(null);
      const outcome = await run(change);
      if (outcome !== true) setError(outcome);
      return outcome === true;
    },
    [run],
  );
  return { error, run: local };
}
