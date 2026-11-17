/**
 * The outbox relay's supervisor (docs/ARCHITECTURE.md §11). apps/api is the only process that relays the outbox to
 * Redis, so a relay that never starts stops every live update (the stream, the Inbox, the cycle strip) until a restart.
 * Until 2026-10-12 the api tried once at boot: a Redis restarting during a deploy, or a private DNS name not resolving
 * yet, left the relay off for the life of the process while /health reported redis:true.
 *
 * Now the supervisor tries again with a capped backoff (1 s, 2 s, 4 s … 30 s) until Redis answers PING, then starts
 * the relay, whose own ticks ride out later Redis errors. `status()` is reported on /health.
 *
 * `wake()` asks the relay to publish now: trpc.ts calls it after every mutation, so the events a founder's click
 * committed reach the stream without waiting for the idle poll (about 220 ms on average until 2026-10-15). Writes made
 * by other services wait for the poll, which stays at 250 ms.
 *
 * One loop relays both outboxes (2026-11-13): the business outbox (`outbox` → `ev:{businessId}`) and the account
 * outbox (`account_outbox` → `ae:{userId}`, docs/ARCHITECTURE.md §5 "Account events"). Each tick runs the business batch
 * and then the account batch, one after the other, so the database pool carries one poller (one probe every 250 ms
 * when both outboxes are empty), as it did before account events existed. A failed account batch is logged and never
 * fails the tick, so a stuck account outbox cannot hold up a project's events; a failed business batch backs the loop
 * off as before.
 *
 * Why one loop: from Nov 12 to 13 the account relay ran as a second loop beside the business one, and production's pool
 * wedged (docs/DECISIONS.md 2026-11-12, and its correction). The root cause was single requests taking the whole pool
 * (fixed by the request-transaction gate, #95, which also keeps a reserve of connections the relays can always use);
 * the second poller made it worse. It was then off (`ACCOUNT_RELAY_ENABLED`, #91) and comes back here, folded in.
 *
 * Stopping never waits more than `RELAY_STOP_TIMEOUT_MS`: a tick blocked behind a starved pool held two shutdowns for
 * their whole 45 s budget on Nov 12. Past the bound the supervisor logs it and moves on; the abandoned query returns
 * its connection when it finishes or when the pool closes.
 */
import { createAccountOutboxRelay, createOutboxRelay, createRelayLoop, type OutboxRelay, type PlatformEvent } from "@foundmill/events";
import type { ApiDeps } from "../context";
import { redisReachable, type ApiRedis } from "./redis";

export type RelayState = "starting" | "waiting_for_redis" | "running" | "stopped";

export interface RelayStatus {
  state: RelayState;
  /** Reachability probes made so far (1 when Redis answered at once). */
  attempts: number;
  /** When the relay started (ISO), null until it does. */
  since: string | null;
}

export interface RelaySupervisor {
  status(): RelayStatus;
  /** Run the relay's next tick now (after committing outbox rows); nothing while it has not started. */
  wake(): void;
  stop(): Promise<void>;
}

/** Whether the relay also publishes the account outbox (in the same loop as the business outbox). */
export const ACCOUNT_RELAY_ENABLED = true;

/** The longest `stop()` waits for the relay's loop to exit before moving on. */
export const RELAY_STOP_TIMEOUT_MS = 5_000;

/** Rows per batch and the idle wait of the one loop (the business relay's own defaults). */
const RELAY_BATCH = 100;
const RELAY_INTERVAL_MS = 250;
const RELAY_ERROR_BACKOFF_MS = 1_000;

/**
 * One loop over two relays: `business` first, then `account` (when there is one), in the same tick. Neither is started
 * on its own; only their `tick()` is used. A business failure fails the tick (the loop backs off, as the business relay
 * always has); an account failure is reported to `onAccountError` and the tick goes on. The tick is "full" (the loop
 * runs again at once) when either batch was.
 */
export function combineRelays(business: OutboxRelay, account: OutboxRelay | null, opts: { onError: (err: unknown) => void; onAccountError: (err: unknown) => void; batch?: number; intervalMs?: number; errorBackoffMs?: number }): OutboxRelay {
  return createRelayLoop({
    tickOnce: async () => {
      const n = await business.tick();
      if (!account) return n;
      let m = 0;
      try {
        m = await account.tick();
      } catch (err) {
        opts.onAccountError(err);
      }
      return Math.max(n, m);
    },
    batch: opts.batch ?? RELAY_BATCH,
    intervalMs: opts.intervalMs ?? RELAY_INTERVAL_MS,
    errorBackoffMs: opts.errorBackoffMs ?? RELAY_ERROR_BACKOFF_MS,
    onError: opts.onError,
  });
}

export interface RelaySupervisorOptions {
  /** Probe Redis (default: PING with a 1.5 s timeout on `deps.redis`). */
  reachable?: () => Promise<boolean>;
  /** Start the relay (default: one loop over the business and account outboxes on `deps.db` and `deps.redis`). */
  start?: () => OutboxRelay;
  /** Whether the default relay also publishes the account outbox (default `ACCOUNT_RELAY_ENABLED`). */
  accountRelay?: boolean;
  /** The longest `stop()` waits (default `RELAY_STOP_TIMEOUT_MS`). */
  stopTimeoutMs?: number;
  /** Wait before the next probe; `attempt` counts from 1 (default: 1 s doubling to 30 s). */
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
  /**
   * Told each batch the relay published, after the rows are marked published (the push notifier, services/push). Fire and
   * forget: the relay never waits for it, and a throw inside it never fails a tick.
   */
  onPublished?: (events: readonly PlatformEvent[]) => void;
}

export const relayBackoffMs = (attempt: number): number => Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));

export function superviseOutboxRelay(deps: Pick<ApiDeps, "db" | "redis" | "log" | "env">, options: RelaySupervisorOptions = {}): RelaySupervisor {
  const redis = deps.redis as ApiRedis | null;
  const reachable = options.reachable ?? (() => redisReachable(redis));
  const withAccount = options.accountRelay ?? ACCOUNT_RELAY_ENABLED;
  const defaultStart = (): OutboxRelay => {
    const db = deps.db as unknown as Parameters<typeof createOutboxRelay>[0];
    const business = createOutboxRelay(db, redis!, {
      onError: (err) => deps.log.warn({ err: (err as Error).message }, "outbox relay tick failed"),
      ...(options.onPublished
        ? {
            onPublished: (events: readonly PlatformEvent[]) => {
              try {
                options.onPublished!(events);
              } catch (err) {
                deps.log.warn({ err: (err as Error).message }, "outbox relay onPublished hook failed");
              }
            },
          }
        : {}),
    });
    let account: OutboxRelay | null = null;
    if (withAccount) {
      // Beside it, never in its way: a failure to build the account relay leaves the business relay running.
      try {
        account = createAccountOutboxRelay(db, redis!, {
          // The relay's errors come from Redis and from validation paths: a message, never a person's event.
          onError: (err) => deps.log.warn({ err: (err as Error).message }, "account outbox relay batch failed"),
        });
      } catch (err) {
        deps.log.warn({ err: (err as Error).message }, "account outbox relay did not start (account events stay in their outbox until a restart)");
      }
    } else {
      deps.log.info({}, "account outbox relay is off (account events wait in their outbox)");
    }
    const loop = combineRelays(business, account, {
      onError: (err) => deps.log.warn({ err: (err as Error).message }, "outbox relay tick failed"),
      onAccountError: (err) => deps.log.warn({ err: (err as Error).message }, "account outbox relay batch failed"),
    });
    loop.start();
    return loop;
  };
  const start = options.start ?? defaultStart;
  const stopTimeoutMs = options.stopTimeoutMs ?? RELAY_STOP_TIMEOUT_MS;
  const backoff = options.backoffMs ?? relayBackoffMs;
  const now = options.now ?? (() => new Date());
  let state: RelayState = "starting";
  let attempts = 0;
  let since: string | null = null;
  let relay: OutboxRelay | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const attempt = async (): Promise<void> => {
    timer = null;
    if (stopped) return;
    attempts += 1;
    const ok = await reachable().catch(() => false);
    if (stopped) return;
    if (!ok) {
      const waitMs = backoff(attempts);
      // Logged on the first miss and then about every ten minutes (twenty probes at the 30 s cap), not on every probe:
      // a local stack without Redis waits here for good.
      if (attempts === 1 || (waitMs >= 30_000 && attempts % 20 === 0)) deps.log.warn({ url: deps.env.REDIS_URL.replace(/\/\/.*@/, "//***@"), attempts, retryInMs: waitMs }, "redis unreachable; outbox relay waits for it (events stay in the outbox until it starts)");
      state = "waiting_for_redis";
      timer = setTimeout(() => void attempt(), waitMs);
      timer.unref?.();
      return;
    }
    relay = start();
    state = "running";
    since = now().toISOString();
    deps.log.info({ attempts, account: withAccount }, "outbox relay started");
  };
  void attempt();

  return {
    status: () => ({ state, attempts, since }),
    wake: () => relay?.wake(),
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      state = "stopped";
      if (!relay) return;
      let bound: ReturnType<typeof setTimeout> | null = null;
      const late = new Promise<"late">((resolve) => {
        bound = setTimeout(() => resolve("late"), stopTimeoutMs);
        (bound as { unref?: () => void }).unref?.();
      });
      const outcome = await Promise.race([relay.stop().then(() => "stopped" as const), late]);
      if (bound) clearTimeout(bound);
      if (outcome === "late") deps.log.warn({ ms: stopTimeoutMs }, "outbox relay did not stop in time (a tick was still waiting); moving on");
    },
  };
}
