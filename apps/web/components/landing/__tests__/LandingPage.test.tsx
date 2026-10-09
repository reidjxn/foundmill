// @vitest-environment happy-dom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { TooltipProvider } from "@foundmill/dugout";
import { MONOGRAM_HEIGHT, MONOGRAM_WIDTH } from "@foundmill/dugout/brand";
import { LandingPage } from "../LandingPage";
import { DECK_CYCLE_MS } from "../CycleDeck";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// happy-dom implements Element.animate, so motion would start (and on unmount cancel) real animations.
MotionGlobalConfig.skipAnimations = true;

// Desktop only: under 1280 px the page renders NeedsLargerWindow instead (happy-dom defaults to 1024).
Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

// happy-dom's IntersectionObserver never reports; the page's lazy parts (the deck's first cycle, the live tiles, the
// Journey) wait for one. This one reports every observed element as on screen straight away.
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
beforeEach(() => {
  globalThis.IntersectionObserver = OnScreenObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  globalThis.IntersectionObserver = realObserver;
  vi.useRealTimers();
});

function renderPage() {
  return render(
    <TooltipProvider>
      <LandingPage terminalRenderer="plain" />
    </TooltipProvider>,
  );
}

describe("LandingPage (signed-out /)", () => {
  it("leads with the tagline and sends every call to action to sign-in", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(APP_TAGLINE);
    const starts = screen.getAllByRole("link", { name: /Start your business/ });
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (const a of [...starts, ...screen.getAllByRole("link", { name: "Sign in" })]) expect(a.getAttribute("href")).toBe("/login");
  });

  it("anchors the header with the wordmark alone and never draws the FM monogram", () => {
    const { container } = renderPage();
    const home = screen.getByRole("link", { name: `${APP_NAME} home` });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.querySelectorAll("svg")).toHaveLength(1);
    expect(home.querySelector("svg")?.getAttribute("height")).toBe("20");
    // The closing call to action has no mark above its headline either.
    expect(container.querySelector("#start-title")?.previousElementSibling).toBeNull();
    // FM is for the favicon only: no monogram glyph or tile anywhere on the page.
    expect(container.querySelector(`svg[viewBox="0 0 ${MONOGRAM_WIDTH} ${MONOGRAM_HEIGHT}"]`)).toBeNull();
    expect(container.querySelector("svg[data-variant]")).toBeNull();
  });

  it("has every section, reachable from the section nav", () => {
    renderPage();
    const nav = screen.getByRole("navigation", { name: "Sections" });
    for (const id of ["why", "how", "team", "live", "journey", "control"]) {
      expect(within(nav).getByRole("link", { name: (_, el) => el.getAttribute("href") === `#${id}` })).toBeTruthy();
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(document.getElementById("channels")).toBeTruthy();
    // One team orbit is announced (the hero's); the closing one is decoration.
    expect(screen.getAllByRole("img", { name: /Your team: you at the centre/ })).toHaveLength(1);
  });

  it("runs a cycle in the hero deck: a decision comes back, then a customer", async () => {
    vi.useFakeTimers();
    renderPage();
    const deck = screen.getByTestId("cycle-deck");
    expect(deck.getAttribute("data-phase")).toBe("idle");
    // The first cycle starts on its own once the deck is on screen.
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(deck.getAttribute("data-phase")).toBe("processing");
    await act(async () => {
      vi.advanceTimersByTime(DECK_CYCLE_MS);
    });
    expect(deck.getAttribute("data-phase")).toBe("decision");
    expect(within(deck).getByRole("button", { name: /Respond to 1 item/ })).toBeTruthy();
    const decision = screen.getByTestId("deck-decision");
    expect(within(decision).getByText("Approve the first print booking?")).toBeTruthy();
    fireEvent.click(within(decision).getByRole("button", { name: "Approve" }));
    expect(deck.getAttribute("data-phase")).toBe("idle");
    expect(within(deck).getByText("Print booking approved")).toBeTruthy();
    // The decision card is gone; keyboard focus moves to Continue, the next thing to press.
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(document.activeElement).toBe(within(deck).getByRole("button", { name: "Continue" }));

    // The visitor presses Continue: the next cycle brings a customer, and Continue turns gold.
    fireEvent.click(within(deck).getByRole("button", { name: "Continue" }));
    expect(deck.getAttribute("data-phase")).toBe("processing");
    await act(async () => {
      vi.advanceTimersByTime(DECK_CYCLE_MS);
    });
    expect(deck.getAttribute("data-phase")).toBe("win");
    const win = screen.getByTestId("deck-win");
    // The same customer as the Customer Update the gold card opens.
    expect(within(win).getByText("Nordic Beauty AB")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Customer Update" })).getAllByText("Nordic Beauty AB").length).toBeGreaterThan(0);
    expect(within(deck).getByRole("button", { name: /Go to Journey/ })).toBeTruthy();
    fireEvent.click(within(win).getByRole("button", { name: /See the Customer Update/ }));
    expect(deck.getAttribute("data-phase")).toBe("idle");
  });

  it("shows each department lead with attribute ratings and the department's real screens", () => {
    renderPage();
    const departments = screen.getByRole("tablist", { name: "Departments" });
    const tabs = within(departments).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["ProductIris", "DevelopmentForge", "DistributionScout", "FinanceLedger", "LegalLex", "TeamAtlas"]);
    expect(screen.getByRole("list", { name: "Product screens" })).toBeTruthy();
    fireEvent.click(within(departments).getByRole("tab", { name: /Development/ }));
    expect(within(departments).getByRole("tab", { name: /Development/ }).getAttribute("aria-selected")).toBe("true");
    const panel = document.getElementById("team-panel")!;
    expect(within(panel).getByText("Lead developer")).toBeTruthy();
    expect(within(panel).getByRole("img", { name: /^Testing: 16 of 20/ })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Development screens" })).getByText("Live sessions")).toBeTruthy();
  });

  it("lets the visitor pause the department tour and the activity ticker", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Pause tour" }));
    expect(screen.getByRole("button", { name: "Play tour" })).toBeTruthy();
    const ticker = screen.getByRole("button", { name: "Pause the activity ticker" });
    fireEvent.click(ticker);
    expect(ticker.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Play the activity ticker" })).toBeTruthy();
  });

  it("states the house rules and labels example data as such", () => {
    renderPage();
    for (const rule of ["Never moves money", "Never signs anything or accepts terms", "Never changes security settings"]) expect(screen.getByText(rule)).toBeTruthy();
    expect(screen.getByText("Recorded example, replayed")).toBeTruthy();
    expect(screen.getAllByText("Example business").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("region", { name: "Channel Board" })).toBeTruthy();
    // The Customer Update and the Inbox note are the example business's.
    expect(screen.getByRole("region", { name: "Customer Update" })).toBeTruthy();
    expect(screen.getByRole("article", { name: "Example Inbox note" })).toBeTruthy();
    // Only milestones the example reached, each labelled as the example business's.
    expect(screen.queryByText("Not yet")).toBeNull();
    expect(screen.getByText(/6 of 6 reached/)).toBeTruthy();
  });

  it("renders the live tiles in the browser only, already mid-session, then streams them", async () => {
    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const grid = screen.getByRole("region", { name: "Example agent sessions" });
    expect(within(grid).getAllByRole("group")).toHaveLength(4);
  });
});

describe("LandingPage server render", () => {
  // The page is server-rendered on Vercel in UTC and hydrated in the visitor's time zone. Any date it prints must read
  // the same in both, or React throws a hydration error (a date-only ISO string prints as the day before west of UTC).
  async function markupIn(timeZone: string): Promise<string> {
    process.env.TZ = timeZone;
    vi.resetModules();
    const [{ renderToString }, { createElement }, dugout, landing] = await Promise.all([import("react-dom/server"), import("react"), import("@foundmill/dugout"), import("../LandingPage")]);
    return renderToString(createElement(dugout.TooltipProvider, null, createElement(landing.LandingPage, { terminalRenderer: "plain" })));
  }

  it("is identical in every time zone, so it hydrates cleanly anywhere", async () => {
    const original = process.env.TZ;
    try {
      const utc = await markupIn("UTC");
      expect(utc).toContain("7 Oct 2026");
      expect(utc).toContain("22 Sep 2025");
      for (const zone of ["America/Los_Angeles", "Pacific/Honolulu", "Asia/Tokyo", "Pacific/Auckland"]) expect(await markupIn(zone), zone).toBe(utc);
    } finally {
      process.env.TZ = original;
      vi.resetModules();
    }
  });
});
