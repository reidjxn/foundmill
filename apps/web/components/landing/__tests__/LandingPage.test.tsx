// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET_THE_APP_WORDS } from "@foundmill/dugout";
import { LandingPage } from "../LandingPage";
import { SWITCHES_OFF, TOUR_ENABLED, type LandingSwitches } from "../flags";
import { LANDING_VARIANTS, type LandingVariant } from "@/lib/landing-variant";
import { LANDING_WORDS as W, VARIANT_WORDS } from "../words";
import { STUDIO_SETS } from "../first-timer-examples";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

beforeEach(() => {
  // The idea box asks the api for this browser's card on mount: none here.
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
});
afterEach(() => vi.unstubAllGlobals());

const renderPage = (switches: Partial<LandingSwitches> = {}) => render(<LandingPage switches={{ ...SWITCHES_OFF, ...switches }} renderDay="2026-11-15" />);
const text = () => document.body.textContent ?? "";

/** The page's sections, in order (DESIGN §9a): daylight, the blue, then the night. */
const ORDER = ["hero", "result", "ways", "studio", "people", "first-week", "control", "vacation", "questions", "start"];

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

  it("labels the idea field visibly and gives every assurance at every width", () => {
    renderPage();
    const field = screen.getByLabelText("What do you want to make?");
    expect(field.tagName).toBe("TEXTAREA");
    expect(document.querySelector('label[for="' + field.id + '"]')!.className).not.toContain("sr-only");
    for (const a of ["Free to start · no card", "Your idea stays private until you choose to share it", "Nothing spends, signs or files without you", "Built for a big screen and your full attention"]) {
      expect(screen.getByText(a)).toBeTruthy();
    }
  });

  it("the free line follows sign-up's stage, and the hero never names a price or promises the product stays free (WP-14 A1)", () => {
    const { unmount } = renderPage({ signupOpen: false });
    expect(screen.getByText(W.hero.assure.freeInvite)).toBeTruthy();
    expect(screen.queryByText(W.hero.assure.freeOpen)).toBeNull();
    unmount();
    renderPage({ signupOpen: true });
    expect(screen.queryByText(W.hero.assure.freeInvite)).toBeNull();
    expect(screen.getByText(W.hero.assure.freeOpen)).toBeTruthy();
    expect(document.getElementById("hero")!.textContent).not.toMatch(/\$\d/);
    expect(text()).not.toMatch(/does not expire|free forever|always free|stays free/i);
  });

  it("shows a real rated example, labeled with the founder's words, beside the box, and says what comes back", () => {
    renderPage();
    const hero = document.getElementById("hero")!;
    // Four examples to switch between, Northwind Skincare first (founder, 2026-11-16), then Tutorlane (2026-11-17).
    const example = within(hero).getByRole("figure", { name: "Example companies you can create" });
    expect(W.hero.exampleLabel).toBe("Example companies you can create");
    expect(within(example).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Northwind", "Tutorlane", "Sole Revival", "Glitchwick"]);
    // "companies" is the landing page's one exception to the project/business rule: this label only.
    expect(document.body.textContent!.match(/\bcompanies\b/gi)?.length ?? 0).toBe(1);
    expect(example.querySelector("[data-idea-name]")!.textContent).toBe("Northwind Skincare");
    const result = document.getElementById("result")!;
    expect(within(result).getByRole("heading", { level: 2 }).textContent).toBe(W.result.title);
    for (const p of W.result.points) expect(result.textContent).toContain(p.lead);
  });

  it("offers the tour three times from 1280 px (top bar, after the Studio, footer), each a link to /tour", () => {
    renderPage();
    const tours = [...document.querySelectorAll<HTMLAnchorElement>('a[href="/tour"]')];
    expect(tours.length).toBe(TOUR_ENABLED ? 3 : 0);
    if (!TOUR_ENABLED) return;
    expect(screen.getByTestId("landing-tour-top").className).toContain("desktop:inline-flex");
    expect(screen.getByTestId("landing-tour").textContent).toContain(W.tour.text);
    expect(document.getElementById("studio")!.contains(screen.getByTestId("landing-tour"))).toBe(true);
  });

  it("never calls the rated idea a card: the word reads as a payment card (founder, 2026-11-16)", () => {
    renderPage();
    // The one use of the word is a payment card, in the founder's own line (WP-14 A1).
    expect(text().replace(W.hero.assure.freeInvite, "")).not.toMatch(/\bcards?\b/i);
  });

  it("names the three ways to start: one sentence, the Ideation Studio, and bringing what already exists", () => {
    renderPage();
    const ways = document.getElementById("ways")!;
    expect(within(ways).getByRole("heading", { level: 2 }).textContent).toBe(W.ways.title);
    expect([...ways.querySelectorAll("[data-way]")].map((w) => w.getAttribute("data-way"))).toEqual(["sentence", "studio", "bring"]);
    expect(ways.textContent).toContain("Ideation Studio");
    expect(ways.textContent).toContain("Import a plan as a Markdown file");
    for (const source of W.ways.bring.sources) expect(ways.textContent).toContain(source);
  });

  it("shows the Ideation Studio with a set of example ideas, labeled and out of search snippets", () => {
    renderPage();
    const studio = document.getElementById("studio")!;
    expect(studio.hasAttribute("data-nosnippet")).toBe(true);
    const frame = within(studio).getByRole("figure", { name: W.studio.label });
    expect([...frame.querySelectorAll("[data-idea-name]")].map((n) => n.textContent)).toEqual(["Sole Revival", "Lace Lab", "Kick Swap"]);
    for (const s of W.studio.steer) expect(frame.textContent).toContain(s);
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

  it("offers a vacation, and says by the house rules that estimates are labeled (WP-14 T10)", () => {
    renderPage();
    const vacation = document.getElementById("vacation")!;
    expect(within(vacation).getByRole("heading", { level: 2 }).textContent).toBe("Take a vacation.");
    expect(vacation.textContent).toContain("Vacation mode: your Chief of Staff keeps things moving within the limits you set, and writes you a report for when you come back.");
    expect(within(document.getElementById("control")!).getByTestId("control-honest").textContent).toBe(W.control.honest);
  });

  it("ends with a way back to the box and the paragraph an answer engine can quote", () => {
    renderPage();
    expect(within(document.getElementById("start")!).getByRole("button", { name: /Shape my idea/ })).toBeTruthy();
    const footer = document.querySelector<HTMLElement>("[data-landing] > footer")!;
    expect(footer.textContent).toContain(W.footer.what);
    expect(within(footer).getByRole("link", { name: W.footer.terms })).toBeTruthy();
    expect(within(footer).queryByRole("link", { name: W.footer.tour }) !== null).toBe(TOUR_ENABLED);
  });

  it("offers the app in the footer under 640 px once the store links are set, and nothing while they are unset (WP-03 T9)", () => {
    const footer = () => document.querySelector<HTMLElement>("[data-landing] > footer")!;
    const { unmount } = renderPage();
    expect(footer().querySelector("[data-get-the-app]")).toBeNull();
    expect(footer().textContent).not.toContain(GET_THE_APP_WORDS.ios);
    unmount();
    const links = { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" };
    render(<LandingPage switches={SWITCHES_OFF} renderDay="2026-11-15" storeLinks={links} />);
    const prompt = footer().querySelector<HTMLElement>("[data-get-the-app]")!;
    expect(prompt.className).toContain("@page-wide:hidden");
    expect(within(prompt).getByRole("link", { name: GET_THE_APP_WORDS.ios }).getAttribute("href")).toBe(links.ios);
    expect(within(prompt).getByRole("link", { name: GET_THE_APP_WORDS.android }).getAttribute("href")).toBe(links.android);
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
    unmount();
    renderPage({ platformMail: true });
    expect(text()).toContain(W.firstWeek.days.d3Follow);
  });
});

describe("LandingPage variants (lib/landing-variant.ts)", () => {
  const renderVariant = (variant: LandingVariant) => render(<LandingPage variant={variant} switches={SWITCHES_OFF} renderDay="2026-11-16" />);

  it.each(LANDING_VARIANTS)("%s: its own headline, field label and first way in, on the same sections", (variant) => {
    const { container } = renderVariant(variant);
    const V = VARIANT_WORDS[variant];
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(V.title);
    expect(screen.getByLabelText(V.label).tagName).toBe("TEXTAREA");
    expect(container.querySelector("[data-way]")!.getAttribute("data-way")).toBe(V.ways[0]);
    expect([...container.querySelectorAll("main > section")].map((s) => s.id)).toEqual(ORDER);
    expect(container.querySelector("[data-landing]")!.getAttribute("data-variant")).toBe(variant);
  });

  it("every variant has a different headline, and each names all three ways once", () => {
    const titles = LANDING_VARIANTS.map((v) => VARIANT_WORDS[v].title);
    expect(new Set(titles).size).toBe(titles.length);
    for (const v of LANDING_VARIANTS) expect([...VARIANT_WORDS[v].ways].sort()).toEqual(["bring", "sentence", "studio"]);
  });

  it("a profile page puts its own hero example first, chosen, and shows its own Studio set", () => {
    const { container } = renderVariant("developer");
    const pills = [...container.querySelectorAll("[data-example-idea]")];
    expect(pills.map((b) => b.getAttribute("data-example-idea"))).toEqual(VARIANT_WORDS.developer.examples);
    expect(pills[0]!.getAttribute("aria-checked")).toBe("true");
    const studio = container.querySelector("#studio")!.textContent!;
    expect(studio).toContain(W.studio.brief(STUDIO_SETS.games.brief));
    expect(studio).toContain("Patchnote");
    expect(studio).not.toContain("Lace Lab");
  });

  it("every Studio set has three ideas, and not every page shows the sneakers set", () => {
    for (const set of Object.values(STUDIO_SETS)) expect(set.cards).toHaveLength(3);
    expect(new Set(LANDING_VARIANTS.map((v) => VARIANT_WORDS[v].studio ?? "sneakers")).size).toBeGreaterThan(5);
  });

  it("the page for a visitor with no idea opens Surprise me; the others leave it closed", () => {
    const { unmount } = renderVariant("no-idea");
    expect(screen.getByTestId("idea-interests")).toBeTruthy();
    unmount();
    renderVariant("first");
    expect(screen.queryByTestId("idea-interests")).toBeNull();
  });
});
