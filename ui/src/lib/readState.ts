// A visitor's read state (spec F4, check 23 visitor part): only in this browser, in
// localStorage. The River makes no server write for it. Members' read state arrives with
// sign-in (M8) and is stored on the server instead.

export const READ_STORAGE_KEY = "mosaic-river:read";
/** Oldest marks are dropped past this many, so the stored list can't grow without bound. */
export const READ_LIMIT = 2000;

/** The parts of Storage this module uses (tests pass a Map-backed fake). */
export type ReadStore = Pick<Storage, "getItem" | "setItem">;

/** The stored ids, oldest mark first. Anything unreadable counts as nothing read. */
export function loadRead(store: ReadStore | undefined): string[] {
  if (!store) return [];
  try {
    const value: unknown = JSON.parse(store.getItem(READ_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function saveRead(store: ReadStore | undefined, ids: readonly string[]): void {
  if (!store) return;
  try {
    store.setItem(READ_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Storage full or blocked: read marks last for this page view only.
  }
}

/** Adds ids (moving any already there to the end), keeping the newest READ_LIMIT. */
export function markRead(current: readonly string[], ids: readonly string[]): string[] {
  const adding = new Set(ids);
  if (adding.size === 0) return [...current];
  const kept = current.filter((id) => !adding.has(id));
  return [...kept, ...adding].slice(-READ_LIMIT);
}

export function markUnread(current: readonly string[], ids: readonly string[]): string[] {
  const removing = new Set(ids);
  return current.filter((id) => !removing.has(id));
}

/** localStorage when the browser allows it. */
export function browserStore(): ReadStore | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
