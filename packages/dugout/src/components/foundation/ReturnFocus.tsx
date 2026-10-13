"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Overlays that pass focus on rather than hold it: a menu, a listbox, a popover's content. */
const PASSING = '[role="menu"], [role="menubar"], [role="listbox"], [data-radix-popper-content-wrapper]';
/** Any overlay: the passing ones and the dialogs, sheets and drawers that hold focus while open. */
const OVERLAY = `${PASSING}, [role="dialog"], [role="alertdialog"]`;

/**
 * Where focus has been, page-wide: the last element focused outside every overlay (the place an overlay opened over),
 * the last one outside a passing overlay, and, while focus is in a menu, where it was before the menu took it. A dialog
 * opened from a menu item ("Merge…" in a row's menu) opens as the menu closes, so the item it came from is gone by the
 * time the dialog closes; the menu's opener (its trigger, the grid) is the place to go back to.
 */
const trail: { outside: HTMLElement | null; settled: HTMLElement | null; menuOpener: HTMLElement | null } = { outside: null, settled: null, menuOpener: null };
let tracking = false;

function onFocusIn(e: FocusEvent) {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;
  if (t.closest(PASSING)) {
    trail.menuOpener ??= trail.settled;
    return;
  }
  trail.settled = t;
  trail.menuOpener = null;
  if (!t.closest(OVERLAY)) trail.outside = t;
}

function onPointerDown(e: PointerEvent) {
  // A press outside any menu is a new place: an older menu's opener no longer is.
  if (!(e.target instanceof Element) || !e.target.closest(PASSING)) trail.menuOpener = null;
}

/** Starts following focus (once, in the browser), seeded with whatever has it now. */
function trackFocus(): void {
  if (tracking || typeof document === "undefined") return;
  tracking = true;
  const active = focusedElement();
  if (active && !active.closest(PASSING)) {
    trail.settled = active;
    if (!active.closest(OVERLAY)) trail.outside = active;
  }
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("pointerdown", onPointerDown, true);
}
// From the first import, so a menu opened before any overlay ever mounted is still followed.
trackFocus();

/** The element that has focus now, or null when nothing (or only the page) has it. */
function focusedElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/** What an overlay goes back to on close: where focus was, else the place it opened over (when `el` has gone). */
export interface FocusOriginRecord {
  el: HTMLElement | null;
  fallback: HTMLElement | null;
}

/** Where an overlay opening now came from: the focused element, or a menu's opener when the menu chose it. */
function captureOrigin(): FocusOriginRecord {
  trackFocus();
  const active = focusedElement();
  const fromMenu = (!active || active.closest(PASSING) !== null) && trail.menuOpener?.isConnected ? trail.menuOpener : null;
  const el = fromMenu ?? active;
  // Opened from inside another overlay that is closing (the palette's "Ask" opens the desk): the place both opened over.
  const fallback = trail.outside && trail.outside !== el ? trail.outside : null;
  return { el, fallback };
}

/**
 * Remembers what had focus when an overlay opened. Render it as the overlay content's **first** child: its layout
 * effect then runs before any `autoFocus` inside the overlay moves focus away from the opener.
 */
export function FocusOrigin({ origin }: { origin: MutableRefObject<FocusOriginRecord | null> }) {
  useIsoLayoutEffect(() => {
    origin.current = captureOrigin();
  }, [origin]);
  return null;
}

/**
 * Focus return for overlays (WCAG 2.4.3). Radix's modal content gives focus back to its own `<DialogTrigger>` on close,
 * but the product opens nearly every dialog, sheet and drawer from a plain button that sets `open`, or from a menu item,
 * so the trigger ref is empty and focus fell to `<body>`: the next Tab restarted at "Skip to content". This returns focus
 * to the element that had it when the overlay opened (captured by `<FocusOrigin>`; for a menu item, the menu's opener),
 * unless the caller's own `onCloseAutoFocus` already placed it (by calling `preventDefault`). When that element has gone
 * (the menu, or another overlay, it sat in has closed) focus goes to the place the overlays opened over; when that has
 * gone too, or cannot take focus, Radix's default runs instead.
 */
export function useReturnFocus(onCloseAutoFocus?: (event: Event) => void) {
  const origin = useRef<FocusOriginRecord | null>(null);
  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const record = origin.current;
      origin.current = null;
      if (event.defaultPrevented || !record) return;
      const el = [record.el, record.fallback].find((c): c is HTMLElement => !!c && c.isConnected);
      if (!el) return;
      el.focus({ preventScroll: true });
      // A control that became disabled meanwhile cannot take focus; then Radix's own return runs.
      if (document.activeElement === el) event.preventDefault();
    },
    [onCloseAutoFocus],
  );
  return { origin, onCloseAutoFocus: handleCloseAutoFocus };
}
