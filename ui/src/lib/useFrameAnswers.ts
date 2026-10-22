// The framing check's answers this visit (ui-revisions-3 item 2): the URL to frame, or null when
// the page refuses framing (or the check failed; the original then opens in a new tab, which is
// always safe). Cards ask ahead of time, as they come into view, so a click already knows whether
// to frame or to open a tab; a click on a card whose answer isn't in yet asks first.
import { useEffect, useState } from "react";
import { loadFrame } from "./api";

/** At most this many checks at a time from this page (the guard allows 2 per host). */
export const FRAME_CHECKS_AT_ONCE = 3;

/**
 * A queue of framing checks: each item is asked once, at most FRAME_CHECKS_AT_ONCE at a time;
 * `now` puts it at the front (a click, an opened address).
 */
export function createFrameChecker(answer: (id: string, url: string | null) => void) {
  const asked = new Set<string>();
  const queue: string[] = [];
  let running = 0;
  const pump = (): void => {
    while (running < FRAME_CHECKS_AT_ONCE && queue.length > 0) {
      const id = queue.shift()!;
      running += 1;
      void loadFrame(id)
        .then((result) => answer(id, result.status === "ok" ? result.url : null))
        .finally(() => {
          running -= 1;
          pump();
        });
    }
  };
  return (id: string, now = false): void => {
    if (asked.has(id)) {
      const at = queue.indexOf(id);
      if (now && at > 0) queue.unshift(...queue.splice(at, 1));
      return;
    }
    asked.add(id);
    if (now) queue.unshift(id);
    else queue.push(id);
    pump();
  };
}

export function useFrameAnswers() {
  const [answers, setAnswers] = useState<Record<string, string | null>>({});
  const [request] = useState(() =>
    createFrameChecker((id, url) => setAnswers((current) => ({ ...current, [id]: url }))),
  );
  return { answers, request };
}

/** Asks for every card marked `data-frame-check` once it is in view (or nearly). */
export function useVisibleFrameChecks(request: (id: string) => void, watch: unknown): void {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.itemId;
          if (id) request(id);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "200px 0px" },
    );
    document.querySelectorAll<HTMLElement>("[data-frame-check]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [request, watch]);
}
