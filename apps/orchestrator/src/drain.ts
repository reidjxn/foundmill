/**
 * Hand-off of running agent sessions when this worker shuts down (a deploy: Railway sends SIGTERM to the old
 * deployment once the new one runs, docs/DEPLOY.md §3 "Redeploys and shutdown").
 *
 * Until 2026-10-12 a deploy cancelled every running session after the 30 s grace: the runner turned the cancellation
 * into a `stopped` or `failed` result, the task ended and the agent was marked failing. Now the shutdown first stops the
 * worker polling, then calls `begin()`: every running session saves its work (no GitHub push, it has not finished) and
 * returns a hand-off, and the agentSession workflow starts the next run at once, on the new worker, where this one
 * stopped (a replay from the same event, a live session from the saved workspace). A session cancelled for a worker
 * shutdown without this call (the grace ran out first) hands off the same way.
 */
export class SessionDrain {
  private draining = false;
  private readonly listeners = new Set<() => void>();

  /** True once the worker started shutting down. */
  get requested(): boolean {
    return this.draining;
  }

  /** Tells every running session to hand off now, and every session that starts from here on at once. */
  begin(): void {
    if (this.draining) return;
    this.draining = true;
    for (const fn of [...this.listeners]) fn();
  }

  /** Calls `fn` when the drain begins (at once when it already has). Returns the unsubscribe. */
  onBegin(fn: () => void): () => void {
    if (this.draining) {
      fn();
      return () => undefined;
    }
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
