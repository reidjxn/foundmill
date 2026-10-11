/**
 * Graceful shutdown for the Node services (docs/DEPLOY.md §3 "Redeploys and shutdown").
 *
 * In the container tini is PID 1 and node its only child (root Dockerfile), so Railway's SIGTERM reaches the service
 * itself, and SIGKILL follows `drainingSeconds` later (railway.toml). `onShutdown` installs SIGTERM/SIGINT handlers
 * that run a service's steps in order (stop taking work, drain what is in flight, close clients), each bounded by
 * what is left of the budget (SHUTDOWN_TIMEOUT_MS, below `drainingSeconds`), log one line per step and exit 0, or 1
 * when a step failed or overran. A second SIGINT exits at once (130) for a developer pressing Ctrl-C twice.
 */

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 45_000;

export interface ShutdownLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  /** pino's `flush`: writes buffered lines out before the process exits. */
  flush?(callback?: (err?: Error) => void): void;
}

/**
 * Flushes the logger (pino buffers and writes asynchronously, so a line logged just before `process.exit` can be lost
 * or land out of order). Bounded: resolves after `ms` whatever happens.
 */
export function flushLog(log: Pick<ShutdownLog, "flush">, ms = 1_000): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof log.flush !== "function") return resolve();
    const timer = setTimeout(resolve, ms);
    try {
      log.flush(() => {
        clearTimeout(timer);
        resolve();
      });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

export interface ShutdownStep {
  name: string;
  /** `remainingMs`: what is left of the whole budget when this step starts. The step is cut off when it runs out. */
  run(budget: { remainingMs: number }): unknown;
}

/** Where signals come from: `process` in a service, an EventEmitter in tests. */
export interface SignalSource {
  on(event: string, listener: () => void): unknown;
  off(event: string, listener: () => void): unknown;
}

export interface ShutdownOptions {
  /** Appears in every log line ("api", "stream", …). */
  service: string;
  log: ShutdownLog;
  /** Run in order. A function is called at shutdown, so steps can use state assigned after `onShutdown` (a server started later). */
  steps: readonly ShutdownStep[] | (() => readonly ShutdownStep[]);
  /** Whole budget from the signal to exit (default 45 000 ms). */
  timeoutMs?: number;
  signals?: readonly string[];
  exit?: (code: number) => void;
  source?: SignalSource;
  now?: () => number;
}

export interface ShutdownHandle {
  /** Runs the steps once, then exits; later calls return the same promise. Resolves with the exit code. */
  shutdown(reason: string): Promise<number>;
  readonly stopping: boolean;
  /** Removes the signal handlers (tests). */
  dispose(): void;
}

type Settled = { status: "ok" } | { status: "timeout" } | { status: "error"; error: unknown };

function settleWithin(fn: () => unknown, ms: number): Promise<Settled> {
  return new Promise<Settled>((resolve) => {
    const timer = setTimeout(() => resolve({ status: "timeout" }), ms);
    Promise.resolve()
      .then(fn)
      .then(
        () => resolve({ status: "ok" }),
        (error: unknown) => resolve({ status: "error", error }),
      )
      .finally(() => clearTimeout(timer));
  });
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function onShutdown(options: ShutdownOptions): ShutdownHandle {
  const { service, log } = options;
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const source: SignalSource = options.source ?? process;
  const now = options.now ?? Date.now;
  const signals = options.signals ?? ["SIGTERM", "SIGINT"];
  let running: Promise<number> | null = null;
  let firstSignal: string | null = null;

  function shutdown(reason: string): Promise<number> {
    if (running) return running;
    running = (async () => {
      const started = now();
      const deadline = started + timeoutMs;
      log.info({ service, reason, timeoutMs }, `${service} shutting down`);
      // Last resort for a step that blocks the event loop or ignores its deadline: never outlive the budget.
      const watchdog = setTimeout(() => {
        log.error({ service, timeoutMs }, `${service} shutdown overran its budget; exiting 1`);
        exit(1);
      }, timeoutMs + 1_000);
      watchdog.unref?.();
      let code = 0;
      const steps = typeof options.steps === "function" ? options.steps() : options.steps;
      for (const step of steps) {
        const remainingMs = deadline - now();
        if (remainingMs <= 0) {
          code = 1;
          log.warn({ service, step: step.name }, `${service} shutdown: no time left for ${step.name}; skipped`);
          continue;
        }
        const stepStarted = now();
        const outcome = await settleWithin(() => step.run({ remainingMs }), remainingMs);
        const ms = now() - stepStarted;
        if (outcome.status === "ok") log.info({ service, step: step.name, ms }, `${service} shutdown: ${step.name}`);
        else if (outcome.status === "timeout") {
          code = 1;
          log.warn({ service, step: step.name, ms }, `${service} shutdown: ${step.name} did not finish in time; moving on`);
        } else {
          code = 1;
          log.error({ service, step: step.name, ms, err: errorMessage(outcome.error) }, `${service} shutdown: ${step.name} failed; moving on`);
        }
      }
      log.info({ service, ms: now() - started, code }, `${service} shutdown complete`);
      await flushLog(log);
      clearTimeout(watchdog);
      exit(code);
      return code;
    })();
    return running;
  }

  const listeners = new Map<string, () => void>();
  for (const signal of signals) {
    const listener = () => {
      if (!running) {
        firstSignal = signal;
        void shutdown(signal);
        return;
      }
      if (signal === "SIGINT" && firstSignal === "SIGINT") {
        log.warn({ service, signal }, `${service}: second SIGINT; exiting now`);
        void flushLog(log, 200).then(() => exit(130));
        return;
      }
      log.info({ service, signal }, `${service}: already shutting down`);
    };
    listeners.set(signal, listener);
    source.on(signal, listener);
  }

  return {
    shutdown,
    get stopping() {
      return running !== null;
    },
    dispose() {
      for (const [signal, listener] of listeners) source.off(signal, listener);
      listeners.clear();
    },
  };
}

/** The parts of a node:http server (what `@hono/node-server`'s `serve` returns) that draining needs. */
export interface DrainableServer {
  close(callback?: (err?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
  getConnections?(callback: (err: Error | null, count: number) => void): unknown;
}

const openConnections = (server: DrainableServer): Promise<number> =>
  new Promise((resolve) => {
    if (!server.getConnections) return resolve(0);
    server.getConnections((err, count) => resolve(err ? 0 : count));
  });

/**
 * Stops accepting connections and lets in-flight requests finish, streamed answers included. `close()` refuses new
 * connections and drops idle keep-alive ones; a keep-alive connection whose response ends later is dropped on the next
 * tick instead of lingering until its keep-alive timeout. Past `timeoutMs` the remaining connections are cut.
 * Resolves with how many connections had to be cut (0 after a clean drain).
 */
export async function drainHttpServer(server: DrainableServer, options: { timeoutMs: number; pollMs?: number }): Promise<{ forced: number }> {
  const closed = new Promise<void>((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
  const tick = setInterval(() => server.closeIdleConnections?.(), Math.max(10, options.pollMs ?? 100));
  tick.unref?.();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    closed.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), Math.max(0, options.timeoutMs));
    }),
  ]);
  clearInterval(tick);
  clearTimeout(timer);
  if (!timedOut) return { forced: 0 };
  const forced = await openConnections(server);
  server.closeAllConnections?.();
  await Promise.race([closed, new Promise<void>((resolve) => setTimeout(resolve, 1_000).unref?.())]);
  return { forced };
}
