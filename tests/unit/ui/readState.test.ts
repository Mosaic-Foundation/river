import { describe, expect, it } from "vitest";
import {
  loadRead,
  markRead,
  markUnread,
  READ_LIMIT,
  READ_STORAGE_KEY,
  saveRead,
  type ReadStore,
} from "../../../ui/src/lib/readState";

// M6: a visitor's read state lives only in the browser (spec F4, check 23 visitor part).
function memoryStore(initial?: string): ReadStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(READ_STORAGE_KEY, initial);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("visitor read state", () => {
  it("round-trips through storage", () => {
    const store = memoryStore();
    saveRead(store, markRead([], ["a", "b"]));
    expect(loadRead(store)).toEqual(["a", "b"]);
    expect(JSON.parse(store.data.get(READ_STORAGE_KEY)!)).toEqual(["a", "b"]);
  });

  it("treats missing, broken or odd values as nothing read", () => {
    expect(loadRead(undefined)).toEqual([]);
    expect(loadRead(memoryStore())).toEqual([]);
    expect(loadRead(memoryStore("{not json"))).toEqual([]);
    expect(loadRead(memoryStore('{"a":1}'))).toEqual([]);
    expect(loadRead(memoryStore('["a", 2, null, "b"]'))).toEqual(["a", "b"]);
  });

  it("survives storage that throws", () => {
    const store: ReadStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(loadRead(store)).toEqual([]);
    expect(() => saveRead(store, ["a"])).not.toThrow();
  });

  it("marks read without duplicates, newest last, and unmarks", () => {
    expect(markRead(["a", "b"], ["a", "c"])).toEqual(["b", "a", "c"]);
    expect(markRead(["a"], [])).toEqual(["a"]);
    expect(markUnread(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });

  it("keeps only the newest marks past the limit", () => {
    const many = Array.from({ length: READ_LIMIT }, (_, i) => `id-${i}`);
    const next = markRead(many, ["new"]);
    expect(next).toHaveLength(READ_LIMIT);
    expect(next[0]).toBe("id-1");
    expect(next.at(-1)).toBe("new");
  });
});
