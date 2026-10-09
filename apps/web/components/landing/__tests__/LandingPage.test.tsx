// @vitest-environment happy-dom
import { act, render, screen, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { describe, expect, it, vi } from "vitest";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";
import { TooltipProvider } from "@foundmill/dugout";
import { MONOGRAM_HEIGHT, MONOGRAM_WIDTH } from "@foundmill/dugout/brand";
import { LandingPage } from "../LandingPage";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

// happy-dom implements Element.animate, so motion would start (and on unmount cancel) real animations.
MotionGlobalConfig.skipAnimations = true;

// Desktop only: under 1280 px the page renders NeedsLargerWindow instead (happy-dom defaults to 1024).
Object.defineProperty(window, "innerWidth", { value: 1440, configurable: true });

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
    expect(starts.length).toBeGreaterThanOrEqual(2);
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
    for (const id of ["how", "departments", "live", "channels", "control"]) {
      expect(within(nav).getByRole("link", { name: (_, el) => el.getAttribute("href") === `#${id}` })).toBeTruthy();
      expect(document.getElementById(id)).toBeTruthy();
    }
    expect(screen.getByRole("img", { name: /Your team: you at the centre/ })).toBeTruthy();
  });

  it("names all six departments with their real screens", () => {
    renderPage();
    for (const name of ["Product", "Development", "Distribution", "Finance", "Legal", "Team"]) expect(screen.getByRole("list", { name: `${name} screens` })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Development screens" })).getByText("Live sessions")).toBeTruthy();
  });

  it("states the house rules and labels example data as such", () => {
    renderPage();
    for (const rule of ["Never moves money", "Never signs anything or accepts terms", "Never changes security settings"]) expect(screen.getByText(rule)).toBeTruthy();
    expect(screen.getByText("Recorded example, replayed")).toBeTruthy();
    expect(screen.getByText("Example business")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Channel Board" })).toBeTruthy();
  });

  it("renders the live tiles in the browser only, then streams them", async () => {
    vi.useFakeTimers();
    renderPage();
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    const grid = screen.getByRole("region", { name: "Example agent sessions" });
    expect(within(grid).getAllByRole("group")).toHaveLength(4);
    vi.useRealTimers();
  });
});
