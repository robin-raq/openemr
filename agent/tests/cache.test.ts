import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TtlCache } from "../src/cache";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("basic get/set", () => {
    it("returns undefined for missing keys", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      expect(cache.get("missing")).toBeUndefined();
    });

    it("stores and retrieves a value", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      expect(cache.get("key1")).toBe("value1");
    });

    it("stores objects by reference", () => {
      const cache = new TtlCache<{ name: string }>({ ttlMs: 60_000, maxEntries: 100 });
      const obj = { name: "test" };
      cache.set("obj", obj);
      expect(cache.get("obj")).toBe(obj);
    });

    it("overwrites existing keys", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "old");
      cache.set("key1", "new");
      expect(cache.get("key1")).toBe("new");
    });
  });

  describe("TTL expiration", () => {
    it("returns value before TTL expires", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      vi.advanceTimersByTime(59_999);
      expect(cache.get("key1")).toBe("value1");
    });

    it("returns undefined after TTL expires", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      vi.advanceTimersByTime(60_001);
      expect(cache.get("key1")).toBeUndefined();
    });

    it("expired entries are removed on access", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      vi.advanceTimersByTime(60_001);
      cache.get("key1"); // triggers cleanup
      expect(cache.size).toBe(0);
    });

    it("different entries can expire independently", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      vi.advanceTimersByTime(30_000);
      cache.set("key2", "value2");
      vi.advanceTimersByTime(31_000); // key1 is 61s old, key2 is 31s old
      expect(cache.get("key1")).toBeUndefined();
      expect(cache.get("key2")).toBe("value2");
    });
  });

  describe("LRU eviction", () => {
    it("evicts least recently used entry when max entries exceeded", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 3 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      cache.set("d", "4"); // should evict "a"
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");
      expect(cache.get("c")).toBe("3");
      expect(cache.get("d")).toBe("4");
    });

    it("accessing a key refreshes its LRU position", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 3 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      cache.get("a"); // refresh "a" — now "b" is LRU
      cache.set("d", "4"); // should evict "b"
      expect(cache.get("a")).toBe("1");
      expect(cache.get("b")).toBeUndefined();
      expect(cache.get("c")).toBe("3");
      expect(cache.get("d")).toBe("4");
    });

    it("setting an existing key refreshes its LRU position", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 3 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.set("c", "3");
      cache.set("a", "updated"); // refresh "a" — now "b" is LRU
      cache.set("d", "4"); // should evict "b"
      expect(cache.get("a")).toBe("updated");
      expect(cache.get("b")).toBeUndefined();
    });
  });

  describe("clear()", () => {
    it("removes all entries", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.clear();
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBeUndefined();
      expect(cache.size).toBe(0);
    });
  });

  describe("has()", () => {
    it("returns true for existing non-expired keys", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      expect(cache.has("key1")).toBe(true);
    });

    it("returns false for missing keys", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      expect(cache.has("missing")).toBe(false);
    });

    it("returns false for expired keys", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("key1", "value1");
      vi.advanceTimersByTime(60_001);
      expect(cache.has("key1")).toBe(false);
    });
  });

  describe("size", () => {
    it("reflects current non-expired entry count", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      expect(cache.size).toBe(0);
      cache.set("a", "1");
      expect(cache.size).toBe(1);
      cache.set("b", "2");
      expect(cache.size).toBe(2);
    });

    it("does not count expired entries after cleanup", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("a", "1");
      vi.advanceTimersByTime(60_001);
      cache.get("a"); // trigger cleanup
      expect(cache.size).toBe(0);
    });
  });

  describe("delete()", () => {
    it("removes a specific entry", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("a", "1");
      cache.set("b", "2");
      cache.delete("a");
      expect(cache.get("a")).toBeUndefined();
      expect(cache.get("b")).toBe("2");
      expect(cache.size).toBe(1);
    });

    it("returns true when entry existed", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      cache.set("a", "1");
      expect(cache.delete("a")).toBe(true);
    });

    it("returns false when entry did not exist", () => {
      const cache = new TtlCache<string>({ ttlMs: 60_000, maxEntries: 100 });
      expect(cache.delete("missing")).toBe(false);
    });
  });
});
