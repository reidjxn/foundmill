"use client";
/**
 * Per-user studio state (shortlist, discard tray, locally restored cards, last prompt) kept in localStorage, because
 * the API has no procedures for the shortlist or for un-discarding (see concepts.ts). Reads once on mount so the
 * server render and the first client render agree (empty state), then writes through on every change.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_STUDIO_STATE, readStudioState, writeStudioState, type StudioState } from "./concepts";

export function useStudioState(userKey: string): [StudioState, (update: (prev: StudioState) => StudioState) => void, boolean] {
  const [state, setState] = useState<StudioState>(EMPTY_STUDIO_STATE);
  const [hydrated, setHydrated] = useState(false);
  const keyRef = useRef(userKey);
  keyRef.current = userKey;

  useEffect(() => {
    setState(readStudioState(typeof window === "undefined" ? undefined : window.localStorage, userKey));
    setHydrated(true);
  }, [userKey]);

  const update = useCallback((fn: (prev: StudioState) => StudioState) => {
    setState((prev) => {
      const next = fn(prev);
      writeStudioState(typeof window === "undefined" ? undefined : window.localStorage, keyRef.current, next);
      return next;
    });
  }, []);

  return [state, update, hydrated];
}
