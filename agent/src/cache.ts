/**
 * Generic TTL cache with LRU eviction.
 *
 * Map-based, no external dependencies. Suitable for caching
 * FHIR responses, DailyMed lookups, and request-scoped data.
 */

export interface TtlCacheOptions {
  /** Time-to-live in milliseconds. Entries older than this are expired on access. */
  ttlMs: number;
  /** Maximum number of entries. When exceeded, the least recently used entry is evicted. */
  maxEntries: number;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A simple TTL + LRU cache backed by a Map.
 *
 * - Map insertion order tracks LRU (most recently used at the end).
 * - On `get`, the entry is re-inserted to move it to the end.
 * - On `set`, if maxEntries is exceeded, the first (oldest-accessed) entry is evicted.
 * - Expired entries are cleaned up lazily on access.
 */
export class TtlCache<T> {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly store: Map<string, CacheEntry<T>> = new Map();

  constructor(options: TtlCacheOptions) {
    this.ttlMs = options.ttlMs;
    this.maxEntries = options.maxEntries;
  }

  /**
   * Retrieve a cached value. Returns undefined if the key is missing or expired.
   * Accessing a key refreshes its LRU position.
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh LRU position: delete and re-insert so it moves to the end
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  /**
   * Store a value with TTL. If maxEntries is exceeded, the LRU entry is evicted.
   */
  set(key: string, value: T): void {
    // If key already exists, delete first to refresh LRU position
    if (this.store.has(key)) {
      this.store.delete(key);
    }

    // Evict LRU entry if at capacity
    if (this.store.size >= this.maxEntries) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Check if a non-expired entry exists for the given key.
   */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Remove a specific entry. Returns true if the entry existed.
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Remove all entries.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Current number of entries (may include expired entries not yet cleaned up).
   */
  get size(): number {
    return this.store.size;
  }
}
