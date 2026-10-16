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
 */
import { runOutboxRelay, type OutboxRelay } from "@foundmill/events";
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

export interface RelaySupervisorOptions {
  /** Probe Redis (default: PING with a 1.5 s timeout on `deps.redis`). */
  reachable?: () => Promise<boolean>;
  /** Start the relay (default: `runOutboxRelay` on `deps.db` and `deps.redis`). */
  start?: () => OutboxRelay;
  /** Wait before the next probe; `attempt` counts from 1 (default: 1 s doubling to 30 s). */
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
}

export const relayBackoffMs = (attempt: number): number => Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt - 1));

export function superviseOutboxRelay(deps: Pick<ApiDeps, "db" | "redis" | "log" | "env">, options: RelaySupervisorOptions = {}): RelaySupervisor {
  const redis = deps.redis as ApiRedis | null;
  const reachable = options.reachable ?? (() => redisReachable(redis));
  const start =
    options.start ??
    (() =>
      runOutboxRelay(deps.db as unknown as Parameters<typeof runOutboxRelay>[0], redis!, {
        onError: (err) => deps.log.warn({ err: (err as Error).message }, "outbox relay tick failed"),
      }));
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
    deps.log.info({ attempts }, "outbox relay started");
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
      await relay?.stop();
    },
  };
}
