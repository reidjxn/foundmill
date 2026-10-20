/**
 * Was this focus the person's doing, with the keyboard? Radix opens a Tooltip or a HoverCard on its trigger's focus
 * event, which the browser also fires for focus moved by script: a dialog's auto-focus lands on its first focusable,
 * and when that is an Estimate chip the tooltip opens by itself and the next Escape closes the tooltip instead of the
 * dialog (the ProvenanceTip finding, UX plan wave B). The browser's `:focus-visible` cannot tell the two apart: a
 * dialog opened with Enter keeps the keyboard's focus ring on whatever it focuses.
 *
 * So this keeps the last thing the person did, pointer or key, and reads a focus as keyboard-driven only when the most
 * recent interaction was a key that moves focus (Tab, the arrows, Home, End, Page Up and Page Down). Enter, Space and
 * Escape activate and close things; the focus they cause is the program's, not the person's, and a tooltip must not
 * open on it. Hover is untouched: the primitives still open on the pointer.
 *
 * No React and no "use client": the listeners attach on first use, in the browser only, once per document.
 */
const FOCUS_KEYS = new Set(["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);

export type LastInteraction = "none" | "pointer" | "focus-key" | "other-key";

let last: LastInteraction = "none";
let tracking = false;

/** Starts following keys and pointers on the window (idempotent; a no-op outside the browser). */
export function trackKeyboardFocus(): void {
  if (tracking || typeof window === "undefined") return;
  tracking = true;
  window.addEventListener(
    "keydown",
    (e) => {
      last = FOCUS_KEYS.has(e.key) ? "focus-key" : "other-key";
    },
    true,
  );
  const pointer = () => {
    last = "pointer";
  };
  window.addEventListener("pointerdown", pointer, true);
  window.addEventListener("mousedown", pointer, true);
  window.addEventListener("touchstart", pointer, true);
}

/** The most recent interaction, for the focus handler that runs right after it. */
export function lastInteraction(): LastInteraction {
  return last;
}

/**
 * True when a focus landing now came from a key that moves focus: open the tooltip. False after a pointer press, an
 * activation key (Enter, Space, Escape: a dialog opening, a card closing) or before any interaction (a page's first
 * auto-focus): keep it closed. Keyboard users still reach it: the next Tab opens it.
 */
export function isKeyboardFocus(): boolean {
  return last === "focus-key";
}

/** For tests: forget the last interaction. */
export function resetKeyboardFocus(): void {
  last = "none";
}
