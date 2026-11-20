// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { CycleDeck, feedTickMs } from "../CycleDeck";
import { ExampleProvider } from "../examples/context";
import { NORTHWIND } from "../examples/northwind";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
MotionGlobalConfig.skipAnimations = true;
Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

// Every observed element is on screen at once.
class OnScreenObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
const realObserver = globalThis.IntersectionObserver;
const realMatchMedia = window.matchMedia;

function reduceMotion(on: boolean) {
  window.matchMedia = ((query: string) =>
    ({ matches: on && query.includes("prefers-reduced-motion"), media: query, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  globalThis.IntersectionObserver = OnScreenObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.IntersectionObserver = realObserver;
  window.matchMedia = realMatchMedia;
});

function renderDeck() {
  render(
    <ExampleProvider initial={NORTHWIND}>
      <TooltipProvider>
        <CycleDeck />
      </TooltipProvider>
    </ExampleProvider>,
  );
  return within(screen.getByTestId("cycle-deck")).getByRole("region", { name: "Live now" });
}

describe("feedTickMs (audit A11Y-14)", () => {
  it("runs fast during a round of work, slowly between rounds of work, and never by itself under reduced motion or when paused", () => {
    expect(feedTickMs({ working: true, reduced: false, paused: false })).toBe(650);
    expect(feedTickMs({ working: false, reduced: false, paused: false })).toBe(2800);
    expect(feedTickMs({ working: false, reduced: true, paused: false })).toBeNull();
    expect(feedTickMs({ working: false, reduced: false, paused: true })).toBeNull();
    // A cycle the visitor starts still plays out, whatever else is set.
    expect(feedTickMs({ working: true, reduced: true, paused: true })).toBe(650);
  });
});

describe("CycleDeck 'Live now' feed", () => {
  it("under reduced motion nothing in the feed changes by itself, and there is nothing to pause", () => {
    reduceMotion(true);
    const live = renderDeck();
    const before = live.textContent;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(live.textContent).toBe(before);
    expect(screen.getByTestId("cycle-deck").getAttribute("data-phase")).toBe("idle");
    expect(screen.queryByTestId("feed-pause")).toBeNull();
  });

  it("otherwise updates between rounds of work, and the visitor can pause and resume the updates", () => {
    reduceMotion(false);
    const live = renderDeck();
    const lines = () => [...live.querySelectorAll("li")].map((li) => li.textContent);
    const pause = screen.getByTestId("feed-pause");
    expect(pause.textContent).toBe("Pause updates");
    expect(pause.getAttribute("aria-pressed")).toBe("false");

    // The deck's own first cycle starts after 1.4 s and ends 4.2 s later; let it finish first.
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    const running = lines();
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(lines()).not.toEqual(running);

    fireEvent.click(pause);
    expect(screen.getByTestId("feed-pause").textContent).toBe("Resume updates");
    expect(screen.getByTestId("feed-pause").getAttribute("aria-pressed")).toBe("true");
    const frozen = lines();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(lines()).toEqual(frozen);

    fireEvent.click(screen.getByTestId("feed-pause"));
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(lines()).not.toEqual(frozen);
  });

  it("fades only the avatars: the words of every line keep full opacity (4.5:1)", () => {
    reduceMotion(false);
    const live = renderDeck();
    const rows = [...live.querySelectorAll("li")];
    expect(rows.length).toBeGreaterThan(2);
    for (const li of rows) expect((li as HTMLElement).style.opacity).toBe("");
    const avatarWrappers = rows.map((li) => li.querySelector<HTMLElement>(":scope > span.shrink-0"));
    expect(avatarWrappers[0]!.style.opacity).toBe("1");
    expect(Number(avatarWrappers[2]!.style.opacity)).toBeLessThan(1);
  });
});
