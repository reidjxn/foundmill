"use client";
/**
 * Runs one streamed draft (`idea.draft`) for the Ideation Studio: folds its events into a `DraftRun`, hands each saved
 * idea to `onIdea` the moment it arrives, and stops it on `stop()` (the request is aborted, so the API stops the model
 * calls; cards already saved stay). The elapsed timer ticks inside `DraftStatus`, so the deck does not re-render with
 * it. The transport is injected (`runner`), so the hook is tested without a server.
 */
import { useCallback, useRef, useState } from "react";
import { applyDraftEvent, failRun, startRun, stopRun, type DraftEvent, type DraftRun, type DraftedIdea } from "./draft-run";

export type DraftRunner<I> = (input: I, signal: AbortSignal) => Promise<AsyncIterable<DraftEvent>>;

export interface DraftRunCallbacks {
  onIdea?: (idea: DraftedIdea) => void;
  onDone?: (event: Extract<DraftEvent, { type: "done" }>) => void;
  onError?: (err: unknown) => void;
  onStop?: () => void;
}

export interface DraftRunControls<I> {
  run: DraftRun | null;
  running: boolean;
  /** Starts a draft; ignored while one runs. Resolves when the stream ends. */
  start: (input: I) => Promise<void>;
  stop: () => void;
}

export function useDraftRun<I>(runner: DraftRunner<I>, callbacks: DraftRunCallbacks = {}): DraftRunControls<I> {
  const [run, setRun] = useState<DraftRun | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const latest = useRef({ runner, callbacks });
  latest.current = { runner, callbacks };
  const running = run?.status === "running";

  const start = useCallback(async (input: I) => {
    if (abortRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRun(startRun(Date.now()));
    try {
      const stream = await latest.current.runner(input, controller.signal);
      for await (const event of stream) {
        if (event.type === "idea") latest.current.callbacks.onIdea?.(event.idea);
        setRun((r) => (r ? applyDraftEvent(r, event, Date.now()) : r));
        if (event.type === "done") latest.current.callbacks.onDone?.(event);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error && err.message ? err.message : "Nothing drafted";
      setRun((r) => (r ? failRun(r, message, Date.now()) : r));
      latest.current.callbacks.onError?.(err);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    const controller = abortRef.current;
    if (!controller) return;
    abortRef.current = null;
    controller.abort();
    setRun((r) => (r ? stopRun(r, Date.now()) : r));
    latest.current.callbacks.onStop?.();
  }, []);

  return { run, running, start, stop };
}
