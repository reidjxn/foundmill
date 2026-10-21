// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { GuidanceProvider, TooltipProvider } from "@foundmill/dugout";
import { MONOGRAM_HEIGHT, MONOGRAM_WIDTH } from "@foundmill/dugout/brand";
import { LandingPage } from "../LandingPage";
import { CONTINUE_CALLOUT, DECK_CALLOUT, DECK_CYCLE_MS } from "../CycleDeck";
import { INCLUDED_CREDITS_ASSURANCE } from "../Hero";
import { FIRST_DAY_PANEL_TITLE, FIRST_DAY_SENTENCE, FIRST_DAY_SIGNOFFS } from "../HowItWorks";
import { resetExampleCache } from "../examples";
import { NORTHWIND } from "../examples/northwind";
import { TUTORLANE } from "../examples/tutorlane";

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
  resetExampleCache();
  window.history.replaceState(null, "", "/");
});

function renderPage(initialExample?: typeof NORTHWIND) {
  return render(
    <TooltipProvider>
      <LandingPage terminalRenderer="plain" initialExample={initialExample} />
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

  it("assures a first-timer on the hero (included credits, no card) and keeps the key assurance for You decide (A13)", () => {
    renderPage();
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    // The figure is the free plan's included credits, from packages/config, in credits' own currency.
    expect(INCLUDED_CREDITS_ASSURANCE).toBe("Starts with $5.00 of included credits · no card");
    expect(within(hero).getByTestId("hero-credits").textContent).toBe(INCLUDED_CREDITS_ASSURANCE);
    expect(within(hero).getByText("Nothing moves money or signs in your name without you")).toBeTruthy();
    expect(within(hero).queryByText(/Anthropic key/)).toBeNull();
    // The key assurance sits beside "Your key, sealed", and nowhere else.
    const control = document.getElementById("control")!;
    expect(within(control).getByText("Your key, sealed")).toBeTruthy();
    // "credits" and "sandbox" are defined words (Term buttons), so the sentence is read whole from its paragraph.
    expect(within(control).getByText(/^Bring your own Anthropic key, or stay on the included/).textContent).toMatch(/^Bring your own Anthropic key, or stay on the included credits\./);
    expect(screen.getAllByText(/Bring your own Anthropic key/)).toHaveLength(1);
  });

  it("walks How it works in four beats, the last the real first day, every one labeled Example", () => {
    renderPage();
    const how = document.getElementById("how")!;
    expect(within(how).getAllByTestId("step-title").map((h) => h.textContent)).toEqual(["Shape the idea", "Make it yours", "Press Continue", "Your first day"]);
    expect(within(how).getAllByText(/^Step 0[1-4]$/)).toHaveLength(4);
    expect(within(how).getAllByText("Example", { exact: true })).toHaveLength(4);
    expect(within(how).getByText(FIRST_DAY_SENTENCE)).toBeTruthy();
    // The foundations drafting panel as Home shows it, with the agents writing it named.
    const panel = within(how).getByRole("region", { name: FIRST_DAY_PANEL_TITLE });
    expect(panel.textContent).toContain("Vision, specification and roadmap");
    expect(within(panel).getByText("Drafting")).toBeTruthy();
    expect(within(panel).getByText("Drafting your vision, specification and roadmap…")).toBeTruthy();
    expect(within(panel).getByText(/^Iris, Product lead, writes it from your idea and your profile\. Orla, Chief of Staff, plans the first cycle from the roadmap\.$/)).toBeTruthy();
    // Then the two sign-off notes in the Inbox, each tagged Respond, then Continue.
    const inbox = within(how).getByRole("list", { name: "Inbox" });
    // Each row: the Product lead's portrait (its name is text too), the subject, the Respond tag.
    const rows = within(inbox).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    rows.forEach((li, i) => expect(li.textContent).toBe(`Iris${FIRST_DAY_SIGNOFFS[i]}Respond`));
    const day = panel.parentElement!;
    expect(within(day).getByText("Continue")).toBeTruthy();
    const planned = TUTORLANE.howItWorks.firstCyclePlan.reduce((s, p) => s + p.tasks, 0);
    expect(within(day).getByText(`Building starts: ${planned} tasks planned`)).toBeTruthy();
    // The sequence reads in order: drafting, the notes, Continue.
    expect(panel.compareDocumentPosition(inbox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inbox.compareDocumentPosition(within(day).getByText("Continue")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
    expect(screen.getAllByRole("img", { name: /Your team: you at the center/ })).toHaveLength(1);
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
    expect(within(decision).getByText("Merge photo grading to production?")).toBeTruthy();
    fireEvent.click(within(decision).getByRole("button", { name: "Merge" }));
    expect(deck.getAttribute("data-phase")).toBe("idle");
    expect(within(deck).getByText("Photo grading merged")).toBeTruthy();
    // The decision card is gone; keyboard focus moves to Continue, the next thing to press.
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    expect(document.activeElement).toBe(within(deck).getByRole("button", { name: "Continue" }));
    // The callout under Continue is the app's own single-step Callout (Dugout Coachmark) with the app's words, anchored
    // to the deck's Continue (its ring, no backdrop), until the visitor presses it.
    expect(CONTINUE_CALLOUT).toBe("This is how you move forward. Press it when you have answered what needs you.");
    const callout = screen.getByRole("dialog", { name: DECK_CALLOUT.title });
    expect(callout.getAttribute("data-tour")).toBe(DECK_CALLOUT.tourId);
    expect(callout.textContent).toContain(DECK_CALLOUT.body);
    expect(within(callout).getByRole("button", { name: "Got it" })).toBeTruthy();
    expect(within(deck).getByTestId("deck-continue").hasAttribute("data-coachmark-active")).toBe(true);
    expect(within(deck).getByTestId("deck-continue").contains(within(deck).getByRole("button", { name: "Continue" }))).toBe(true);
    // Nothing modal: no backdrop, the page is not made inert.
    expect(document.querySelector("[aria-hidden='true'][data-aria-hidden]")).toBeNull();

    // The visitor presses Continue: the next cycle brings a customer, and Continue turns gold.
    fireEvent.click(within(deck).getByRole("button", { name: "Continue" }));
    expect(deck.getAttribute("data-phase")).toBe("processing");
    // The callout and its ring leave with the press (synchronously: waitFor never settles under fake timers).
    expect(screen.queryByRole("dialog", { name: DECK_CALLOUT.title })).toBeNull();
    expect(document.querySelector("[data-coachmark-ring]")).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(DECK_CYCLE_MS);
    });
    expect(deck.getAttribute("data-phase")).toBe("win");
    const win = screen.getByTestId("deck-win");
    // The same customer as the Customer Update the gold card opens.
    expect(within(win).getByText("Okafor Math Tutoring")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Customer Update" })).getAllByText("Okafor Math Tutoring").length).toBeGreaterThan(0);
    expect(within(deck).getByRole("button", { name: /Go to Journey/ })).toBeTruthy();
    fireEvent.click(within(win).getByRole("button", { name: /See the Customer Update/ }));
    expect(deck.getAttribute("data-phase")).toBe("idle");
  });

  it("keeps the deck's Continue callout off when guidance is off: tutoring, not information", async () => {
    vi.useFakeTimers();
    render(
      <GuidanceProvider value={{ guidance: "off" }}>
        <TooltipProvider>
          <LandingPage terminalRenderer="plain" />
        </TooltipProvider>
      </GuidanceProvider>,
    );
    const deck = screen.getByTestId("cycle-deck");
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    await act(async () => {
      vi.advanceTimersByTime(DECK_CYCLE_MS);
    });
    expect(deck.getAttribute("data-phase")).toBe("decision");
    fireEvent.click(within(screen.getByTestId("deck-decision")).getByRole("button", { name: "Merge" }));
    expect(deck.getAttribute("data-phase")).toBe("idle");
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByRole("dialog", { name: DECK_CALLOUT.title })).toBeNull();
    expect(document.querySelector("[data-coachmark-ring]")).toBeNull();
    // The deck itself, the decision it brought back and the Inbox stay: guidance off hides tutoring only.
    expect(within(deck).getByText("Photo grading merged")).toBeTruthy();
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

  it("prices the example business in US dollars and tells its story in US English", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const { container } = renderPage();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    // The example's own figures print as dollars ("$42.00", never "£42.00" or "US$42.00").
    expect(within(screen.getByTestId("cycle-deck")).getByText(/^\$\d+\.\d\d$/)).toBeTruthy();
    expect(screen.getByText(/departments · \$5\.06$/)).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Customer Update" })).getByText("$42.00")).toBeTruthy();
    const note = screen.getByRole("article", { name: "Example Inbox note" });
    expect(note.querySelector('[data-value="$480.00"]')).toBeTruthy();
    expect(within(note).getByText(/^It costs \$480, above the \$250 cap/)).toBeTruthy();
    expect(within(note).getByText(/^Mon, Oct 12 · /).textContent).toBe("Mon, Oct 12 · cycle 215");
    expect(screen.getByText("$10K MRR")).toBeTruthy();
    // Nothing of the earlier sterling, UK-schooled example is left.
    const text = container.textContent ?? "";
    for (const gone of ["£", "GBP", "Maths", "GCSE", "A-level", "Tuition", "UK "]) expect(text, gone).not.toContain(gone);
    expect(text).toContain("SAT quadratics: 40 practice questions");
  });

  it("prints the dollars in the product's own parts as $ too, never en-GB's US$", async () => {
    vi.useFakeTimers();
    renderPage();
    // Let the live tiles render, each with its cost in the footer. (The Journey Ribbon needs a measured width, so its
    // revenue scale and readout are covered by e2e/landing.spec.ts.)
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const tiles = within(screen.getByRole("region", { name: "Example agent sessions" })).getAllByRole("group");
    for (const tile of tiles) expect(within(tile).getByText(/^\$\d+\.\d\d$/)).toBeTruthy();
    // Milestone values (TrophyCabinet) and the DecisionBar's cost line for screen readers.
    expect(screen.getByText("$29.00")).toBeTruthy();
    expect(screen.getByText("$290.00")).toBeTruthy();
    expect(screen.getByText(/^Recommended\. Scout books the sponsorship and the copy runs next week\. \$480\.00 \(Estimate\)\. Not reversible\.$/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("US$");
    for (const el of document.body.querySelectorAll("[aria-label], [title]")) expect(`${el.getAttribute("aria-label")} ${el.getAttribute("title")}`).not.toContain("US$");
  });

  it("shows Tutorlane by default and offers the three example businesses above the deck", () => {
    renderPage();
    expect(screen.getByTestId("landing").getAttribute("data-example")).toBe("tutorlane");
    const picker = screen.getByRole("radiogroup", { name: "Watch it run" });
    expect(within(picker).getAllByRole("radio").map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    // The picker sits above the hero's product screen.
    expect(picker.compareDocumentPosition(screen.getByTestId("cycle-deck")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("swaps every section to the business the visitor picks, in its brand colours, and restarts the deck on it", async () => {
    renderPage();
    const landing = screen.getByTestId("landing");
    expect(landing.style.getPropertyValue("--kit-primary")).toBe("#2B6CB0");
    fireEvent.click(screen.getByRole("radio", { name: "Glitchwick" }));
    await waitFor(() => expect(landing.getAttribute("data-example")).toBe("glitchwick"));
    expect(window.location.search).toBe("?example=glitchwick");
    expect(landing.style.getPropertyValue("--kit-primary")).toBe("#c94a2c");

    // The hero deck starts afresh on Glitchwick: its name, its chapter, the cycle after its own last one.
    const deck = screen.getByTestId("cycle-deck");
    expect(deck.getAttribute("data-example")).toBe("glitchwick");
    expect(deck.getAttribute("data-phase")).toBe("idle");
    expect(within(deck).getByText("Glitchwick")).toBeTruthy();
    expect(within(deck).getByText(/Cycle 197 · Chapter 9/)).toBeTruthy();
    expect(screen.getByText(/^Glitchwick is an example business\./)).toBeTruthy();
    // The ticker, the team, the Journey, the Customer Update, the milestones, the board and the Inbox note follow.
    expect(screen.getByRole("region", { name: "What the Glitchwick team did this week" })).toBeTruthy();
    const tabs = within(screen.getByRole("tablist", { name: "Departments" })).getAllByRole("tab");
    // Development, the hero department of a developer-tools business, leads the tabs.
    expect(tabs.map((t) => t.textContent)).toEqual(["DevelopmentBolt", "ProductEcho", "DistributionFlare", "FinanceMint", "LegalVerity", "TeamHarbor"]);
    expect(within(screen.getByRole("region", { name: "Customer Update" })).getAllByText("Kettlebird Games").length).toBeGreaterThan(0);
    expect(screen.getByText("On GitHub Marketplace")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Channel Board" })).toBeTruthy();
    expect(within(screen.getByRole("article", { name: "Example Inbox note" })).getByText("Sponsor the Slow Turns Jam on itch.io?")).toBeTruthy();
    // Nothing of Tutorlane is left outside the picker.
    const main = screen.getByRole("main");
    const picker = screen.getByTestId("example-picker");
    const outside = (main.textContent ?? "").replace(picker.textContent ?? "", "");
    for (const gone of ["Tutorlane", "Okafor", "tutor"]) expect(outside, gone).not.toContain(gone);
  });

  it("opens on a deep-linked business with its own departments, customer and note", () => {
    renderPage(NORTHWIND);
    expect(screen.getByTestId("landing").getAttribute("data-example")).toBe("northwind");
    expect(screen.getByRole("radio", { name: "Northwind Skincare" }).getAttribute("aria-checked")).toBe("true");
    expect(within(screen.getByTestId("cycle-deck")).getByText("Northwind Skincare")).toBeTruthy();
    const departments = screen.getByRole("tablist", { name: "Departments" });
    expect(within(departments).getByRole("tab", { name: /Formulation Lab/ })).toBeTruthy();
    expect(within(departments).getByRole("tab", { name: /Retail Partnerships/ })).toBeTruthy();
    fireEvent.click(within(departments).getByRole("tab", { name: /Formulation Lab/ }));
    expect(within(screen.getByRole("list", { name: "Formulation Lab screens" })).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Specialists", "Live sessions", "Plan"]);
    expect(within(screen.getByRole("region", { name: "Customer Update" })).getAllByText("Larkfield Market").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("article", { name: "Example Inbox note" })).getByText("Formulation Lab")).toBeTruthy();
    // A purchase order's strip: the deposit and the landed cost in place of a channel's fit.
    expect(within(screen.getByRole("article", { name: "Example Inbox note" })).getByText("Landed cost per routine")).toBeTruthy();
  });

  it("dates the deck's top bar, the Inbox note and the Customer Update today, not a fixed day", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    renderPage();
    expect(within(screen.getByTestId("cycle-deck")).getByTestId("kitbar-date").textContent).toBe("Oct 15, 2026");
    expect(within(screen.getByRole("article", { name: "Example Inbox note" })).getByText(/^Thu, Oct 15 · /).textContent).toBe("Thu, Oct 15 · cycle 215");
    // The Customer Update moves with the story: first seen on Sunday, Sep 20 on its calendar, eight days later today.
    expect(within(screen.getByRole("region", { name: "Customer Update" })).getByText(/to the site on a Monday evening\.$/)).toBeTruthy();
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

  it("hydrates a deep-linked business without a mismatch: the server and the browser render the same business", async () => {
    vi.resetModules();
    const [{ renderToString }, { createElement }, { hydrateRoot }, dugout, landing, northwind] = await Promise.all([import("react-dom/server"), import("react"), import("react-dom/client"), import("@foundmill/dugout"), import("../LandingPage"), import("../examples/northwind")]);
    const tree = createElement(dugout.TooltipProvider, null, createElement(landing.LandingPage, { terminalRenderer: "plain", initialExample: northwind.NORTHWIND }));
    const html = renderToString(tree);
    expect(html).toContain("Larkfield Market");
    expect(html).toContain('data-example="northwind"');
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")));
    try {
      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) });
      });
      expect(errors).toEqual([]);
      expect(container.querySelector('[data-testid="landing"]')?.getAttribute("data-example")).toBe("northwind");
      act(() => root!.unmount());
    } finally {
      consoleError.mockRestore();
      container.remove();
      vi.resetModules();
    }
  });

  it("a page prerendered on an earlier day hydrates without a mismatch, then shows the visitor's day", async () => {
    // `/` is prerendered and served for up to an hour (app/page.tsx): the HTML can be from yesterday (and from last year
    // on New Year's Day). Hydration reads the day it was rendered on; the browser's own day follows.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2025-12-31T23:30:00Z"));
    vi.resetModules();
    const [{ renderToString }, { createElement }, { hydrateRoot }, dugout, landing] = await Promise.all([import("react-dom/server"), import("react"), import("react-dom/client"), import("@foundmill/dugout"), import("../LandingPage")]);
    const tree = createElement(dugout.TooltipProvider, null, createElement(landing.LandingPage, { terminalRenderer: "plain", renderDay: "2025-12-31" }));
    const html = renderToString(tree);
    expect(html).toContain("Wed, Dec 31");
    expect(html.replaceAll("<!-- -->", "")).toContain(`© 2025 ${APP_NAME}`);
    vi.setSystemTime(new Date("2026-01-02T15:00:00Z"));
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void errors.push(args.join(" ")));
    try {
      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(container, tree, { onRecoverableError: (e) => errors.push(e) });
      });
      expect(errors).toEqual([]);
      expect(container.textContent).toContain("Fri, Jan 2");
      expect(container.textContent).toContain(`© 2026 ${APP_NAME}`);
      act(() => root!.unmount());
    } finally {
      consoleError.mockRestore();
      container.remove();
      vi.useRealTimers();
      vi.resetModules();
    }
  });

  it("is identical in every time zone, so it hydrates cleanly anywhere", async () => {
    const original = process.env.TZ;
    // Late in the UTC day: already tomorrow in Tokyo and Auckland. The deck's date is the server's (UTC) day until it hydrates.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T20:00:00Z"));
    try {
      const utc = await markupIn("UTC");
      expect(utc).toContain("Oct 12, 2026");
      expect(utc).toContain("Mon, Oct 12");
      // The 100th customer's card (Sep 25, 2025 on the story's calendar) moves with the story: five days to today.
      expect(utc).toContain("Sep 30, 2025");
      for (const zone of ["America/Los_Angeles", "Pacific/Honolulu", "Asia/Tokyo", "Pacific/Auckland"]) expect(await markupIn(zone), zone).toBe(utc);
    } finally {
      vi.useRealTimers();
      process.env.TZ = original;
      vi.resetModules();
    }
  });
});
