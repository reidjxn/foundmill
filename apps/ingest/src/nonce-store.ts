/**
 * Nonce store for webhook replay protection (BUILD §14 "replay protection (timestamp + nonce store)").
 *
 * A nonce is `connector + delivery id` (Stripe event id, GitHub delivery id, Shopify webhook id, SendGrid
 * signature, or a hash of the raw body when the vendor sends nothing unique). `has` is a read-only probe the
 * router runs *before* signature verification so a captured delivery is answered 409 without re-doing the
 * crypto; `claim` records the id only *after* verification passed, so an attacker cannot poison the store
 * with ids of deliveries that were never genuine.
 *
 * Two implementations: in-memory (per process; development, tests, and the fallback) and Redis (`SET NX PX`,
 * shared across replicas). The Redis store degrades to memory on the first error and says so once.
 */

export interface NonceStore {
  readonly kind: "memory" | "redis";
  /** True when the nonce was recorded earlier and has not expired. */
  has(key: string): Promise<boolean>;
  /** Records the nonce for `ttlMs`. Returns true the first time, false when it was already present. */
  claim(key: string, ttlMs: number): Promise<boolean>;
  /** Forgets a claimed nonce (the write behind it failed, so the vendor's retry must be accepted). */
  release(key: string): Promise<void>;
  /** Closes the connection behind the store, if any (shutdown). */
  close?(): Promise<void>;
}

export interface MemoryNonceStoreOptions {
  now?: () => number;
  /** Upper bound on remembered nonces; the oldest are evicted first. */
  max?: number;
}

export class MemoryNonceStore implements NonceStore {
  readonly kind = "memory" as const;
  private readonly seen = new Map<string, number>();
  private readonly nowFn: () => number;
  private readonly max: number;

  constructor(options: MemoryNonceStoreOptions = {}) {
    this.nowFn = options.now ?? Date.now;
    this.max = options.max ?? 100_000;
  }

  async has(key: string): Promise<boolean> {
    const expiresAt = this.seen.get(key);
    if (expiresAt === undefined) return false;
    if (expiresAt <= this.nowFn()) {
      this.seen.delete(key);
      return false;
    }
    return true;
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    if (await this.has(key)) return false;
    this.seen.set(key, this.nowFn() + Math.max(1, ttlMs));
    this.sweep();
    return true;
  }

  async release(key: string): Promise<void> {
    this.seen.delete(key);
  }

  get size(): number {
    return this.seen.size;
  }

  private sweep(): void {
    const now = this.nowFn();
    if (this.seen.size > this.max / 2) {
      for (const [k, exp] of this.seen) if (exp <= now) this.seen.delete(k);
    }
    while (this.seen.size > this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }
}

/** The ioredis surface the Redis store uses (structural, so tests can stub it and the app needs no hard dependency). */
export interface RedisNonceClient {
  set(key: string, value: string, px: "PX", milliseconds: number, nx: "NX"): Promise<"OK" | null>;
  exists(...keys: string[]): Promise<number>;
  del(...keys: string[]): Promise<number>;
  /** ioredis `quit` (graceful) and `disconnect`; optional so stubs need not implement them. */
  quit?(): Promise<unknown>;
  disconnect?(): void;
}

export interface RedisNonceStoreOptions {
  /** Key prefix; one namespace per deployment. */
  prefix?: string;
  /** Called once when Redis fails and the store falls back to memory. */
  onFallback?: (error: unknown) => void;
  memory?: MemoryNonceStore;
}

export class RedisNonceStore implements NonceStore {
  readonly kind = "redis" as const;
  private readonly fallback: MemoryNonceStore;
  private readonly prefix: string;
  private degraded = false;

  constructor(
    private readonly redis: RedisNonceClient,
    private readonly options: RedisNonceStoreOptions = {},
  ) {
    this.fallback = options.memory ?? new MemoryNonceStore();
    this.prefix = options.prefix ?? "ingest:nonce:";
  }

  get isDegraded(): boolean {
    return this.degraded;
  }

  async has(key: string): Promise<boolean> {
    if (this.degraded) return this.fallback.has(key);
    try {
      return (await this.redis.exists(this.prefix + key)) > 0;
    } catch (e) {
      this.degrade(e);
      return this.fallback.has(key);
    }
  }

  async claim(key: string, ttlMs: number): Promise<boolean> {
    if (this.degraded) return this.fallback.claim(key, ttlMs);
    try {
      const reply = await this.redis.set(this.prefix + key, "1", "PX", Math.max(1, ttlMs), "NX");
      return reply === "OK";
    } catch (e) {
      this.degrade(e);
      return this.fallback.claim(key, ttlMs);
    }
  }

  async release(key: string): Promise<void> {
    if (this.degraded) return this.fallback.release(key);
    try {
      await this.redis.del(this.prefix + key);
    } catch (e) {
      this.degrade(e);
      await this.fallback.release(key);
    }
  }

  async close(): Promise<void> {
    if (!this.redis.quit) return this.redis.disconnect?.();
    await this.redis.quit().catch(() => this.redis.disconnect?.());
  }

  private degrade(error: unknown): void {
    if (this.degraded) return;
    this.degraded = true;
    this.options.onFallback?.(error);
  }
}

/** Nonce key: one namespace per connector so two vendors reusing an id format never collide. */
export const nonceKey = (connector: string, deliveryId: string): string => `${connector}:${deliveryId}`;
