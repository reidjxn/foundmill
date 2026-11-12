/**
 * The polling loop both outbox relays run (./relay for business events, ./account-relay for account events): tick,
 * drain without pausing while batches come back full, sleep the idle interval otherwise, wake early on `wake()`, back
 * off after a failed tick (doubling up to 30 s) and stop cleanly. Each relay owns one loop, so a relay that keeps
 * failing backs off on its own and never holds the other one up.
 */

/** What every outbox relay exposes. */
export interface OutboxRelay {
  /** Publish one batch now. Resolves to the number of rows marked published (valid + dead-lettered). */
  tick(): Promise<number>;
  /** Start the polling loop (no-op if already running). */
  start(): void;
  /**
   * Run the next tick now instead of after the idle wait (call it after committing outbox rows). A wake during a tick
   * runs one more right after it, so rows committed while it read are not left to the poll. Ignored while the loop is
   * not running or is backing off after a failure.
   */
  wake(): void;
  /** Stop after the in-flight tick finishes. Resolves when the loop has exited. */
  stop(): Promise<void>;
  readonly running: boolean;
  /** Resolves when the loop exits (after `stop()`). Resolved immediately if never started. */
  readonly done: Promise<void>;
}

export interface RelayLoopOptions {
  /** One batch: resolves to the number of rows marked published. Never called while another call is in flight. */
  tickOnce: () => Promise<number>;
  /** Rows per tick: a tick that returns at least this many is followed by another at once. */
  batch: number;
  /** Idle wait between ticks. */
  intervalMs: number;
  /** Backoff after a failed tick, doubling up to 30 s. */
  errorBackoffMs: number;
  onError: (err: unknown) => void;
}

interface LoopSignal {
  cancelled: boolean;
  /** Ends the current sleep early (set while sleeping). */
  wake?: () => void;
  /** A `wake()` arrived while no idle sleep was running: the next idle sleep returns at once. */
  woken: boolean;
}

/** An idle wait (`wakeable`) ends early on `wake()` or `stop()`; a backoff after a failure ends early only on `stop()`. */
const sleep = (ms: number, signal: LoopSignal, wakeable: boolean) =>
  new Promise<void>((resolve) => {
    if (signal.cancelled) return resolve();
    if (wakeable && signal.woken) {
      signal.woken = false;
      return resolve();
    }
    const t = setTimeout(() => {
      signal.wake = undefined;
      resolve();
    }, ms);
    const end = () => {
      clearTimeout(t);
      signal.wake = undefined;
      resolve();
    };
    signal.wake = wakeable ? end : () => (signal.cancelled ? end() : undefined);
  });

/** Build a relay around `tickOnce` without starting it. */
export function createRelayLoop(opts: RelayLoopOptions): OutboxRelay {
  const { tickOnce, batch, intervalMs, errorBackoffMs, onError } = opts;
  const state: LoopSignal & { running: boolean } = { running: false, cancelled: false, wake: undefined, woken: false };
  let loopPromise: Promise<void> = Promise.resolve();
  let inFlight: Promise<number> | null = null;

  function tick(): Promise<number> {
    if (inFlight) return inFlight;
    inFlight = tickOnce().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function loop(): Promise<void> {
    let backoff = errorBackoffMs;
    while (!state.cancelled) {
      let n: number;
      try {
        n = await tick();
        backoff = errorBackoffMs;
      } catch (err) {
        onError(err);
        await sleep(backoff, state, false);
        backoff = Math.min(backoff * 2, 30_000);
        continue;
      }
      if (state.cancelled) break;
      if (n >= batch) continue; // more waiting: drain without pausing
      await sleep(intervalMs, state, true);
    }
    state.running = false;
  }

  return {
    tick,
    start() {
      if (state.running) return;
      state.running = true;
      state.cancelled = false;
      state.woken = false;
      loopPromise = loop();
    },
    wake() {
      if (!state.running || state.cancelled) return;
      if (state.wake) state.wake();
      else state.woken = true;
    },
    async stop() {
      if (!state.running) return;
      state.cancelled = true;
      state.wake?.();
      await loopPromise;
    },
    get running() {
      return state.running;
    },
    get done() {
      return loopPromise;
    },
  };
}
