"use client";
/**
 * Which example business the landing page shows. `ExampleProvider` holds the business on screen and the visitor's
 * choice; every section reads the business with `useExample()`, and the picker reads and changes the choice with
 * `useExampleChoice()`.
 *
 * Choosing a business that is already loaded swaps the page at once; otherwise the option shows as pending while its
 * chunk loads, and the page keeps the previous business until it arrives. The swap is a short crossfade of the whole
 * page (a same-document view transition, animated by the browser's own CSS), instant under reduced motion or where view
 * transitions are not supported. The URL follows the choice with `history.replaceState` (no navigation, no scroll), so
 * the address can be shared as a deep link.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { prefersReducedMotion } from "@foundmill/dugout";
import { DEFAULT_EXAMPLE, DEFAULT_EXAMPLE_ID, EXAMPLE_IDS, EXAMPLE_PARAM, exampleSearch, isExampleId, loadExample, peekExample, prefetchExample, rememberExample, type ExampleBusiness, type ExampleId } from "./index";

export interface ExampleChoice {
  /** The business on screen. */
  business: ExampleBusiness;
  /** The visitor's choice: the business on screen, or the one loading to replace it. */
  selected: ExampleId;
  /** The chosen business while its content loads, else null. */
  pending: ExampleId | null;
  select: (id: ExampleId) => void;
  /** Starts loading a business the visitor is likely to choose (pointer over or focus on its option). */
  prefetch: (id: ExampleId) => void;
}

const ExampleContext = createContext<ExampleChoice | null>(null);

/** Prefetch the other businesses this long after first paint at the latest, if the browser never goes idle. */
const IDLE_PREFETCH_TIMEOUT_MS = 4000;

export function ExampleProvider({ initial = DEFAULT_EXAMPLE, children }: { initial?: ExampleBusiness; children: ReactNode }) {
  const [business, setBusiness] = useState(initial);
  const [selected, setSelected] = useState<ExampleId>(initial.identity.id);
  const [pending, setPending] = useState<ExampleId | null>(null);
  // The latest choice and the business on screen, for promise callbacks that outlive the render that started them.
  const chosen = useRef<ExampleId>(initial.identity.id);
  const shown = useRef<ExampleBusiness>(initial);

  useEffect(() => {
    rememberExample(initial);
    // A deep link the server could not read (`?example=unknown`) is dropped from the address.
    const value = new URLSearchParams(window.location.search).get(EXAMPLE_PARAM);
    if (value !== null && !isExampleId(value)) writeAddress(initial.identity.id);
  }, [initial]);

  // On idle after first paint, fetch the other businesses so a later choice swaps at once.
  useEffect(() => {
    const run = () => EXAMPLE_IDS.forEach((id) => prefetchExample(id));
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(run, { timeout: IDLE_PREFETCH_TIMEOUT_MS });
      return () => window.cancelIdleCallback(handle);
    }
    const t = setTimeout(run, IDLE_PREFETCH_TIMEOUT_MS / 2);
    return () => clearTimeout(t);
  }, []);

  const show = useCallback((next: ExampleBusiness) => {
    const swap = () => {
      shown.current = next;
      setBusiness(next);
      setPending(null);
    };
    if (shown.current.identity.id === next.identity.id) swap();
    else crossfade(swap);
  }, []);

  const select = useCallback(
    (id: ExampleId) => {
      if (id === chosen.current) return;
      chosen.current = id;
      setSelected(id);
      writeAddress(id);
      const ready = peekExample(id);
      if (ready) {
        show(ready);
        return;
      }
      setPending(id);
      loadExample(id).then(
        (loadedBusiness) => {
          if (chosen.current === id) show(loadedBusiness);
        },
        () => {
          // The chunk did not arrive (offline, a deploy in between): stay on the business on screen.
          if (chosen.current !== id) return;
          const back = shown.current.identity.id;
          chosen.current = back;
          setSelected(back);
          setPending(null);
          writeAddress(back);
        },
      );
    },
    [show],
  );

  const value = useMemo<ExampleChoice>(() => ({ business, selected, pending, select, prefetch: prefetchExample }), [business, selected, pending, select]);
  return <ExampleContext.Provider value={value}>{children}</ExampleContext.Provider>;
}

/** The example business on screen. Outside a provider (a section rendered alone in a test), the default business. */
export function useExample(): ExampleBusiness {
  return useContext(ExampleContext)?.business ?? DEFAULT_EXAMPLE;
}

export function useExampleChoice(): ExampleChoice {
  const choice = useContext(ExampleContext);
  if (!choice) throw new Error("useExampleChoice needs an ExampleProvider");
  return choice;
}

/**
 * Puts the choice in the address bar without a navigation: `/?example=glitchwick` (the deep link the proxy serves the
 * tour from), or `/tour` for the default. The examples live on the tour only (founder, 2026-11-15).
 */
function writeAddress(id: ExampleId): void {
  const { pathname, search, hash } = window.location;
  const next = `${id === DEFAULT_EXAMPLE_ID ? "/tour" : "/"}${exampleSearch(id, search)}${hash}`;
  if (next !== `${pathname}${search}${hash}`) window.history.replaceState(null, "", next);
}

type DocumentWithTransitions = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/**
 * Runs a state update inside a same-document view transition, so the browser crossfades the old page into the new one
 * with CSS (`::view-transition-old/new(root)`, timed in globals.css under `html[data-example-swap]`). Instant when the
 * visitor prefers reduced motion or the browser has no view transitions.
 */
function crossfade(update: () => void): void {
  const doc = document as DocumentWithTransitions;
  if (typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    update();
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-example-swap", "");
  try {
    const transition = doc.startViewTransition.call(doc, () => flushSync(update));
    transition.finished.finally(() => root.removeAttribute("data-example-swap")).catch(() => {});
  } catch {
    root.removeAttribute("data-example-swap");
    update();
  }
}
