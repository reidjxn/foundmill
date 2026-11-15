// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "../LandingPage";
import { SWITCHES_OFF, TOUR_ENABLED, type LandingSwitches } from "../flags";
import { LANDING_WORDS as W } from "../words";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => {
  // The idea box asks the api for this browser's card on mount: none here.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
});
afterEach(() => vi.unstubAllGlobals());

const renderPage = (switches: Partial<LandingSwitches> = {}) => render(<LandingPage switches={{ ...SWITCHES_OFF, ...switches }} renderDay="2026-11-15" />);
const text = () => document.body.textContent ?? "";

/** The page's sections, in the order DIRECTION §3 sets. */
const ORDER = ["hero", "card", "people", "first-week", "control", "cost", "questions", "start"];

describe("LandingPage (signed-out /, DIRECTION §3)", () => {
  it("has one h1, the first-timer's headline", () => {
    renderPage();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe(W.hero.title);
  });

  it("renders the sections in order, with people in the first half of the page", () => {
    const { container } = renderPage();
    const ids = [...container.querySelectorAll("main > section")].map((s) => s.id);
    expect(ids).toEqual(ORDER);
    expect(ids.indexOf("people")).toBeLessThan(ids.length / 2);
  });

  it("has one filled main action at the top, the idea box's button, and nothing in the top bar that competes", () => {
    renderPage();
    const banner = document.querySelector<HTMLElement>("[data-landing] > header")!;
    expect(within(banner).queryByRole("button")).toBeNull();
    expect(within(banner).getByRole("link", { name: W.topBar.signIn }).getAttribute("href")).toBe("/login");
    const hero = document.getElementById("hero")!;
    expect(hero.querySelectorAll(".idea-gen-filled")).toHaveLength(1);
  });

  it("labels the idea field visibly and gives all three assurances at every width", () => {
    renderPage();
    const field = screen.getByLabelText("What do you want to make?");
    expect(field.tagName).toBe("TEXTAREA");
    expect(document.querySelector('label[for="' + field.id + '"]')!.className).not.toContain("sr-only");
    for (const a of ["Your first card is free and needs no sign-up", "Your idea stays private until you choose to share it", "Nothing spends money or signs in your name without you"]) {
      expect(screen.getByText(a)).toBeTruthy();
    }
  });

  it("shows a real example card labeled Example under 'What comes back'", () => {
    renderPage();
    const card = document.getElementById("card")!;
    expect(within(card).getAllByRole("heading", { level: 2 })[0]!.textContent).toBe(W.card.title);
    expect(within(card).getByRole("figure", { name: "Example" }).querySelector("[data-idea-name]")!.textContent).toBe("Sole Revival");
  });

  it("says solo is complete before it says anything about people, then the three things that work today", () => {
    renderPage();
    const people = document.getElementById("people")!;
    const t = people.textContent!;
    expect(t.indexOf(W.people.lede)).toBeLessThan(t.indexOf(W.people.intro));
    for (const p of W.people.points) expect(t).toContain(p.lead);
    expect(within(people).getByRole("figure", { name: "Example" })).toBeTruthy();
    // The solo guard (NETWORK.md §10): nothing says a person needs someone, or is behind without one.
    expect(text()).not.toMatch(/need(s)? (a|another) (cofounder|person|partner)|on your own is not|just you/i);
  });

  it("labels every example and keeps the example week out of search snippets", () => {
    renderPage();
    for (const fig of document.querySelectorAll("[data-screen-frame]")) expect(fig.textContent).toMatch(/^Example/);
    const week = document.getElementById("first-week")!;
    expect(week.hasAttribute("data-nosnippet")).toBe(true);
    expect(within(week).getByRole("figure", { name: W.firstWeek.label })).toBeTruthy();
  });

  it("states the house rules, the cost and the questions, with native details", () => {
    renderPage();
    expect(document.getElementById("control")!.textContent).toContain(W.control.rules);
    expect(document.getElementById("cost")!.textContent).toContain(W.cost.allowance);
    expect(W.cost.allowance).toContain("$5.00");
    expect(document.querySelectorAll("#questions details").length).toBeGreaterThanOrEqual(W.questions.always.length);
  });

  it("ends with a way back to the box and the paragraph an answer engine can quote", () => {
    renderPage();
    expect(within(document.getElementById("start")!).getByRole("button", { name: /Shape my idea/ })).toBeTruthy();
    const footer = document.querySelector<HTMLElement>("[data-landing] > footer")!;
    expect(footer.textContent).toContain(W.footer.what);
    expect(within(footer).getByRole("link", { name: W.footer.terms })).toBeTruthy();
    expect(within(footer).queryByRole("link", { name: W.footer.tour }) !== null).toBe(TOUR_ENABLED);
  });

  it("wears Foundmill's own look: no example business's brand colors on the page root", () => {
    renderPage();
    const root = document.querySelector("[data-landing]") as HTMLElement;
    expect(root.style.getPropertyValue("--kit-primary")).toBe("");
  });
});

describe("LandingPage switches (DIRECTION §6)", () => {
  it("renders the find-people block and top-bar link only when the people layer is on", () => {
    const { unmount } = renderPage({ peopleOpen: false });
    expect(screen.queryByRole("link", { name: W.topBar.findPeople })).toBeNull();
    expect(text()).not.toContain(W.people.findTitle);
    unmount();
    renderPage({ peopleOpen: true });
    const links = screen.getAllByRole("link", { name: W.topBar.findPeople });
    expect(links.length).toBe(2);
    for (const a of links) expect(a.getAttribute("href")).toBe("/network");
    expect(text()).toContain(W.people.findTitle);
    expect(text()).not.toMatch(/coming soon|opening soon/i);
  });

  it("tells the truth about the door: closed, the waiting line and question; open, neither", () => {
    const { unmount } = renderPage({ signupOpen: false });
    expect(text()).toContain(W.hero.door);
    expect(text()).toContain(W.hero.ledeClosed);
    expect(text()).toContain(W.questions.getIn.question);
    unmount();
    renderPage({ signupOpen: true });
    expect(text()).not.toContain(W.hero.door);
    expect(text()).toContain(W.hero.ledeOpen);
    expect(text()).not.toContain(W.questions.getIn.question);
  });

  it("prints the lines that need a confirmation email only with platform mail on", () => {
    const { unmount } = renderPage({ platformMail: false });
    expect(text()).not.toContain(W.firstWeek.days.d3Follow);
    expect(text()).toContain(W.questions.limitsMail);
    unmount();
    renderPage({ platformMail: true });
    expect(text()).toContain(W.firstWeek.days.d3Follow);
    expect(text()).not.toContain(W.questions.limitsMail);
  });
});
