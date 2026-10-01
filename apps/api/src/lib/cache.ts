import type { Redis } from 'ioredis';

export interface Cache {
  readonly kind: 'redis' | 'memory';
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

const PREFIX = 'railtrack:';

export class RedisCache implements Cache {
  readonly kind = 'redis' as const;
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.redis.get(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(PREFIX + key, JSON.stringify(value), 'EX', Math.max(1, Math.round(ttlSeconds)));
  }

  async del(key: string): Promise<void> {
    await this.redis.del(PREFIX + key);
  }
}

/** Bounded in-process cache used when Redis is not configured (development, tests). */
export class MemoryCache implements Cache {
  readonly kind = 'memory' as const;
  private readonly store = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly maxEntries = 5_000) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    // Refresh recency for LRU eviction.
    this.store.delete(key);
    this.store.set(key, entry);
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.store.delete(key);
    this.store.set(key, { value: JSON.stringify(value), expiresAt: Date.now() + ttlSeconds * 1000 });
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest === undefined) break;
      this.store.delete(oldest);
    }
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

/**
 * A cache failure must never break a request. Errors are reported and the call is served by an
 * in-process fallback cache, so provider quotas stay protected while Redis is unavailable.
 */
export class SafeCache implements Cache {
  constructor(
    private readonly inner: Cache,
    private readonly onError: (err: unknown, op: string) => void,
    private readonly fallback: Cache = new MemoryCache(1_000),
  ) {}

  get kind() {
    return this.inner.kind;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      return await this.inner.get<T>(key);
    } catch (err) {
      this.onError(err, 'get');
      return this.fallback.get<T>(key);
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.inner.set(key, value, ttlSeconds);
    } catch (err) {
      this.onError(err, 'set');
      await this.fallback.set(key, value, ttlSeconds);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.inner.del(key);
    } catch (err) {
      this.onError(err, 'del');
    }
    await this.fallback.del(key);
  }
}
