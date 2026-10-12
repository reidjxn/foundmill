"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The element that has focus now, or null when nothing (or only the page) has it. */
function focusedElement(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/**
 * Remembers what had focus when an overlay opened. Render it as the overlay content's **first** child: its layout
 * effect then runs before any `autoFocus` inside the overlay moves focus away from the opener.
 */
export function FocusOrigin({ origin }: { origin: MutableRefObject<HTMLElement | null> }) {
  useIsoLayoutEffect(() => {
    origin.current = focusedElement();
  }, [origin]);
  return null;
}

/**
 * Focus return for overlays (WCAG 2.4.3). Radix's modal content gives focus back to its own `<DialogTrigger>` on close,
 * but the product opens nearly every dialog, sheet and drawer from a plain button that sets `open`, so the trigger ref
 * is empty and focus fell to `<body>`: the next Tab restarted at "Skip to content". This returns focus to the element
 * that had it when the overlay opened (captured by `<FocusOrigin>`), unless the caller's own `onCloseAutoFocus` already
 * placed it (by calling `preventDefault`). When that element has gone (the row it sat on was removed) or cannot take
 * focus, Radix's default runs instead.
 */
export function useReturnFocus(onCloseAutoFocus?: (event: Event) => void) {
  const origin = useRef<HTMLElement | null>(null);
  const handleCloseAutoFocus = useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event);
      const el = origin.current;
      origin.current = null;
      if (event.defaultPrevented || !el || !el.isConnected) return;
      el.focus({ preventScroll: true });
      // A control that became disabled meanwhile cannot take focus; then Radix's own return runs.
      if (document.activeElement === el) event.preventDefault();
    },
    [onCloseAutoFocus],
  );
  return { origin, onCloseAutoFocus: handleCloseAutoFocus };
}
