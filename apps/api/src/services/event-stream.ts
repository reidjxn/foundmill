/**
 * Turns a run that reports progress through `emit` into an async iterable of its events, for a tRPC async-generator
 * procedure streamed over `httpBatchStreamLink` (apps/web `STREAMING_PROCEDURES`).
 *
 * - Events are yielded in the order they were emitted; the run is never blocked by a slow reader.
 * - Stopping the iteration (the browser closed the stream, or the founder pressed Stop) aborts the run's signal.
 * - A run that fails throws its error after the events it emitted, unless the stream was stopped first.
 *
 * The same shape as the Studio's `draftEventStream` (services/ideation.ts), for any event type.
 */
export async function* eventStream<E>(run: (emit: (event: E) => void, signal: AbortSignal) => Promise<unknown>, parent?: AbortSignal): AsyncGenerator<E, void, undefined> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  const queue: E[] = [];
  let wake: (() => void) | null = null;
  let finished = false;
  let failure: { error: unknown } | null = null;
  const emit = (event: E) => {
    queue.push(event);
    wake?.();
  };
  const running = run(emit, controller.signal).then(
    () => undefined,
    (error: unknown) => {
      failure = { error };
    },
  );
  void running.finally(() => {
    finished = true;
    wake?.();
  });
  try {
    for (;;) {
      while (queue.length > 0) yield queue.shift()!;
      if (finished) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
    const failed = failure as { error: unknown } | null;
    if (failed && !controller.signal.aborted) throw failed.error;
  } finally {
    controller.abort();
    parent?.removeEventListener("abort", onAbort);
  }
}
