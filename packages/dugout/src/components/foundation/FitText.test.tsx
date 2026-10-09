import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { FitText, fitScale, fitTextFloor, middleTruncate, type FitState } from "./FitText";

/* One shared ResizeObserver serves every FitText: capture its callback and the elements it watches. */
const watched = new Set<Element>();
let notify: ResizeObserverCallback | null = null;
class MockResizeObserver {
  constructor(cb: ResizeObserverCallback) {
    notify = cb;
  }
  observe(el: Element) {
    watched.add(el);
  }
  unobserve(el: Element) {
    watched.delete(el);
  }
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver = MockResizeObserver;

/** Give the box its available width and the ghost its natural width, then let the observer report a resize. */
function resize(box: HTMLElement, avail: number, natural: number) {
  Object.defineProperty(box, "clientWidth", { configurable: true, get: () => avail });
  const ghost = box.querySelector(".fit-ghost") as HTMLElement;
  Object.defineProperty(ghost, "scrollWidth", { configurable: true, get: () => natural });
  act(() => notify?.([{ target: box } as unknown as ResizeObserverEntry], {} as ResizeObserver));
}

const boxOf = (container: HTMLElement) => container.querySelector("[data-fit-box]") as HTMLElement;

beforeEach(() => {
  // The base size comes from the ghost's computed font size.
  vi.spyOn(window, "getComputedStyle").mockImplementation(() => ({ fontSize: "20px" }) as CSSStyleDeclaration);
});
afterEach(() => vi.restoreAllMocks());

describe("fit maths", () => {
  it("keeps the base size when the text fits", () => {
    expect(fitScale(100, 200, 20, 15)).toEqual({ px: 20, state: "fits" });
  });
  it("steps the size down in 0.5 px to fit the slot", () => {
    expect(fitScale(200, 170, 20, 15)).toEqual({ px: 17, state: "scaled" });
  });
  it("stops at the floor and reports truncation", () => {
    expect(fitScale(400, 160, 20, 15)).toEqual({ px: 15, state: "truncated" });
  });
  it("floors at 11 px for body text, 75 % for small display, 60 % for large figures (never below 11)", () => {
    expect(fitTextFloor(13)).toBe(11);
    expect(fitTextFloor(20)).toBe(15);
    expect(fitTextFloor(30)).toBe(18);
    expect(fitTextFloor(10.5)).toBe(10.5);
  });
  it("middle-truncates ids and emails keeping both ends", () => {
    expect(middleTruncate("inv_8f2c41d9_2041", 9)).toBe("inv_…2041");
    expect(middleTruncate("short", 9)).toBe("short");
  });
});

describe("FitText", () => {
  it("renders the same markup on the server: no measurement, no scale, the ghost copy from data-text", () => {
    const html = renderToString(<FitText tooltip={false}>Retail Partnerships</FitText>);
    expect(html).toContain('data-text="Retail Partnerships"');
    expect(html).not.toContain("data-fit=");
    expect(html).not.toContain("--fit");
    // The text is in the DOM once (the ghost draws it from data-text), so getByText and screen readers see one copy.
    expect(html.match(/Retail Partnerships/g)).toHaveLength(2);
  });

  it("registers with the shared observer and unregisters on unmount", () => {
    const { container, unmount } = render(<FitText>Sourcing</FitText>);
    const box = boxOf(container);
    expect(watched.has(box)).toBe(true);
    unmount();
    expect(watched.has(box)).toBe(false);
  });

  it("leaves text that fits at full size", () => {
    const onFit = vi.fn();
    const { container } = render(<FitText onFitChange={onFit}>Sales</FitText>);
    const box = boxOf(container);
    resize(box, 200, 120);
    expect(box.getAttribute("data-fit")).toBe("fits");
    expect(box.style.getPropertyValue("--fit")).toBe("");
    expect(onFit).not.toHaveBeenCalled();
  });

  it("scales the text down to the slot without changing the box (the ghost keeps the width)", () => {
    const onFit = vi.fn();
    const { container } = render(<FitText onFitChange={onFit}>Sourcing and Manufacturing Specialist</FitText>);
    const box = boxOf(container);
    resize(box, 170, 200);
    expect(box.getAttribute("data-fit")).toBe("scaled");
    expect(box.style.getPropertyValue("--fit")).toBe("0.85");
    expect(onFit).toHaveBeenLastCalledWith("scaled");
    expect(screen.getByText("Sourcing and Manufacturing Specialist").className).toContain("fit-text");
  });

  it("truncates at the floor, reports it, and grows back when the slot widens", () => {
    const states: FitState[] = [];
    const { container } = render(<FitText onFitChange={(s) => states.push(s)}>Retail Partnerships</FitText>);
    const box = boxOf(container);
    resize(box, 100, 400);
    expect(box.getAttribute("data-fit")).toBe("truncated");
    expect(box.style.getPropertyValue("--fit")).toBe("0.75");
    resize(box, 500, 400);
    expect(box.getAttribute("data-fit")).toBe("fits");
    expect(box.style.getPropertyValue("--fit")).toBe("");
    expect(states).toEqual(["truncated", "fits"]);
  });

  it("respects a caller's floor", () => {
    const { container } = render(<FitText minPx={18}>Formulation Lab</FitText>);
    const box = boxOf(container);
    resize(box, 100, 200);
    expect(box.style.getPropertyValue("--fit")).toBe("0.9");
    expect(box.getAttribute("data-fit")).toBe("truncated");
  });

  it("middle-truncates into a separate copy and keeps the full text for screen readers", () => {
    const { container } = render(<FitText truncate="middle">inv_8f2c41d9a7e34b12_2041</FitText>);
    const box = boxOf(container);
    resize(box, 200, 400);
    expect(box.hasAttribute("data-fit-alt")).toBe(true);
    const alt = box.querySelector(".fit-alt") as HTMLElement;
    expect(alt.getAttribute("aria-hidden")).toBe("true");
    expect(alt.textContent).toMatch(/^inv.*….*41$/);
    expect(screen.getByText("inv_8f2c41d9a7e34b12_2041")).toBeTruthy();
  });

  it("never truncates numbers: shows the fallback instead", () => {
    const { container } = render(
      <FitText truncate={false} fallback="SEK 1.2m">
        SEK 1,234,567.00
      </FitText>,
    );
    const box = boxOf(container);
    expect(box.querySelector('[data-truncate="false"]')).not.toBeNull();
    resize(box, 50, 400);
    expect(box.getAttribute("data-fit")).toBe("truncated");
    expect((box.querySelector(".fit-alt") as HTMLElement).textContent).toBe("SEK 1.2m");
  });

  it("measures again when the text changes inside the same box", () => {
    const onFit = vi.fn();
    const { container, rerender } = render(<FitText onFitChange={onFit}>Team</FitText>);
    const box = boxOf(container);
    resize(box, 100, 80);
    expect(box.getAttribute("data-fit")).toBe("fits");
    Object.defineProperty(box.querySelector(".fit-ghost") as HTMLElement, "scrollWidth", { configurable: true, get: () => 400 });
    rerender(<FitText onFitChange={onFit}>Sourcing and Manufacturing Specialist</FitText>);
    expect(box.getAttribute("data-fit")).toBe("truncated");
    expect(onFit).toHaveBeenLastCalledWith("truncated");
  });

  it("two lines: wraps first, then steps down until two lines hold the text", () => {
    const { container } = render(<FitText lines={2}>Order two SKUs now, the serum after its stability review</FitText>);
    const box = boxOf(container);
    const text = box.querySelector(".fit-text") as HTMLElement;
    expect(text.getAttribute("data-lines")).toBe("2");
    // Two lines are 32 px; the copy overflows them until the size is 85 % or less.
    Object.defineProperty(text, "clientHeight", { configurable: true, get: () => 32 });
    Object.defineProperty(text, "scrollHeight", { configurable: true, get: () => (Number(box.style.getPropertyValue("--fit") || 1) > 0.85 ? 48 : 32) });
    resize(box, 120, 400);
    expect(box.getAttribute("data-fit")).toBe("scaled");
    expect(Number(box.style.getPropertyValue("--fit"))).toBeLessThanOrEqual(0.85);
  });

  it("puts the tooltip on the box itself (no wrapper element), and none when the caller owns the tooltip", () => {
    const { container } = render(<FitText>Retail Partnerships and Wholesale</FitText>);
    const box = boxOf(container);
    resize(box, 60, 400);
    expect(box.getAttribute("data-state")).toBe("closed");
    expect(box.parentElement).toBe(container);
    const { container: c2 } = render(<FitText tooltip={false}>Retail</FitText>);
    expect(boxOf(c2).hasAttribute("data-state")).toBe(false);
  });
});
