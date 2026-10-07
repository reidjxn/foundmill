"use client";
/**
 * Keyboard map (BUILD §5.5) for apps/web. Dugout's AppShell binds Space, G chords, / and ⌘K, ? and Esc itself and
 * takes the remaining callbacks (R, J, K, E, 1–4). Pages register those callbacks here; the shell reads them.
 *
 *   const register = useShellKeyboard();
 *   useEffect(() => register({ onEditLayout: () => setEditing((e) => !e) }), [register]);
 *
 * `departmentLetters` / `shortcutList` are re-exported so other code (settings, help copy) shows the same chords.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { AppShellKeyboard } from "@foundmill/dugout";

export { CHORD_TIMEOUT_MS, KEYBOARD_SHORTCUTS, RESERVED_SECTION_LETTERS, departmentLetters, letterCandidates, shortcutList, useKeyboardMap } from "@foundmill/dugout";
export type { GoToTarget, KeyboardMapContext } from "@foundmill/dugout";

/** The callbacks a page can register. Everything else is wired by the shell. */
export type PageShortcuts = Pick<AppShellKeyboard, "onRefreshInbox" | "onNextInboxItem" | "onPrevInboxItem" | "onChooseOption" | "onEditLayout" | "onEscape">;

export interface KeyboardRegistry {
  /** Register page callbacks; returns an unregister function. Later registrations win per key. */
  register: (shortcuts: PageShortcuts) => () => void;
  subscribe: (listener: () => void) => () => void;
  /** Merged callbacks (the most recent registration of each key). */
  current: () => PageShortcuts;
}

export function createKeyboardRegistry(): KeyboardRegistry {
  const entries: PageShortcuts[] = [];
  const listeners = new Set<() => void>();
  let snapshot: PageShortcuts = {};
  const recompute = () => {
    const merged: PageShortcuts = {};
    for (const e of entries) {
      for (const key of Object.keys(e) as (keyof PageShortcuts)[]) {
        const fn = e[key];
        if (fn) (merged as Record<string, unknown>)[key] = fn;
      }
    }
    snapshot = merged;
    for (const l of listeners) l();
  };
  return {
    register: (shortcuts) => {
      entries.push(shortcuts);
      recompute();
      return () => {
        const i = entries.indexOf(shortcuts);
        if (i >= 0) entries.splice(i, 1);
        recompute();
      };
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current: () => snapshot,
  };
}

const Ctx = createContext<KeyboardRegistry | null>(null);
export const KeyboardRegistryProvider = Ctx.Provider;

/** Pages: register their shortcut callbacks. */
export function useShellKeyboard(): (shortcuts: PageShortcuts) => () => void {
  const reg = useContext(Ctx);
  return useCallback((shortcuts: PageShortcuts) => (reg ? reg.register(shortcuts) : () => {}), [reg]);
}

/** Register for the component's lifetime; the callbacks always see the latest closure. */
export function usePageShortcuts(shortcuts: PageShortcuts): void {
  const register = useShellKeyboard();
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  const keys = Object.keys(shortcuts)
    .filter((k) => Boolean((shortcuts as Record<string, unknown>)[k]))
    .sort()
    .join(",");
  useEffect(() => {
    if (!keys) return;
    const bound: PageShortcuts = {};
    for (const key of keys.split(",") as (keyof PageShortcuts)[]) {
      (bound as Record<string, unknown>)[key] = (...args: unknown[]) => (latest.current[key] as ((...a: unknown[]) => void) | undefined)?.(...args);
    }
    return register(bound);
  }, [keys, register]);
}

/** The shell: the merged callbacks for AppShell's `keyboard` prop. */
export function useRegisteredShortcuts(): PageShortcuts {
  const reg = useContext(Ctx);
  const empty = useMemo<PageShortcuts>(() => ({}), []);
  return useSyncExternalStore(
    (l) => (reg ? reg.subscribe(l) : () => {}),
    () => (reg ? reg.current() : empty),
    () => empty,
  );
}
