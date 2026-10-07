/** Imported at the top of every distribution screen test: happy-dom lacks a few browser APIs Radix and motion touch. */
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === "undefined") {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
}
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = ((query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}
if (typeof Element !== "undefined") {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  for (const k of ["scrollIntoView", "hasPointerCapture", "setPointerCapture", "releasePointerCapture"]) {
    if (typeof proto[k] !== "function") proto[k] = () => false;
  }
  // happy-dom's WAAPI rejects with AbortError when motion cancels a layout animation on unmount; without `animate`
  // motion falls back to its JS driver, which is what the Formation Board tests in dugout rely on too.
  Object.defineProperty(Element.prototype, "animate", { value: undefined, configurable: true, writable: true });
}

afterEach(() => cleanup());
