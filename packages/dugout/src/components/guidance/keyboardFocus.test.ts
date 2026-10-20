// @vitest-environment happy-dom
/**
 * keyboardFocus: reads a focus as the person's only after a key that moves focus; a pointer press, an activation key
 * or no interaction at all (a dialog's auto-focus) reads as the program's.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isKeyboardFocus, lastInteraction, resetKeyboardFocus, trackKeyboardFocus } from "./keyboardFocus";

const key = (k: string) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

describe("keyboardFocus", () => {
  beforeEach(() => {
    trackKeyboardFocus();
    resetKeyboardFocus();
  });
  afterEach(resetKeyboardFocus);

  it("reads nothing as keyboard focus before any interaction (a page's first auto-focus)", () => {
    expect(lastInteraction()).toBe("none");
    expect(isKeyboardFocus()).toBe(false);
  });

  it("Tab, the arrows, Home, End and the page keys move focus; Enter, Space and Escape do not", () => {
    for (const k of ["Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]) {
      key(k);
      expect(isKeyboardFocus(), k).toBe(true);
    }
    for (const k of ["Enter", " ", "Escape", "a"]) {
      key(k);
      expect(isKeyboardFocus(), k).toBe(false);
      expect(lastInteraction()).toBe("other-key");
    }
  });

  it("a pointer press after a Tab means the next focus is the program's (a click opened a dialog)", () => {
    key("Tab");
    expect(isKeyboardFocus()).toBe(true);
    window.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(lastInteraction()).toBe("pointer");
    expect(isKeyboardFocus()).toBe(false);
    key("Tab");
    expect(isKeyboardFocus()).toBe(true);
  });

  it("attaches its listeners once, however many primitives mount", () => {
    trackKeyboardFocus();
    trackKeyboardFocus();
    key("Tab");
    expect(isKeyboardFocus()).toBe(true);
  });
});
