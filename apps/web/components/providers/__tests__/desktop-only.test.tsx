// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viewport } from "../../../app/layout";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { DesktopOnly, SMALL_SCREEN_PREFIXES, WorksOnSmallScreens, isTodayPath, worksOnSmallScreens } from "../DesktopOnly";

let pathname = "/b/x/today";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
// The note's controls have their own test (continue-later.test.tsx), with the providers they need.
vi.mock("../ContinueLater", () => ({ ContinueLater: ({ pathname: p, signedIn }: { pathname: string; signedIn: boolean }) => <p data-testid="continue-later" data-path={p} data-signed-in={String(signedIn)} /> }));

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

describe("desktop only (audit PAS-4: a phone rendered a 390 px slice of a 1280 px page)", () => {
  const original = window.innerWidth;
  afterEach(() => {
    setWidth(original);
    pathname = "/b/x/today";
  });

  it("knows Today's path, for the phone title row's Explain this page (WP-04 T7)", () => {
    const id = "0f9b5f8e-3c1d-4d2a-9b7e-2a6c8d1e4f00";
    expect(isTodayPath(`/b/${id}/today`)).toBe(true);
    expect(isTodayPath(`/b/${id}/inbox`)).toBe(false);
    expect(isTodayPath(null)).toBe(false);
  });

  it("does not force a 1280 px layout viewport: the meta keeps Next's device-width, so a phone reports its real width", () => {
    expect((viewport as { width?: unknown }).width).toBeUndefined();
  });

  it("renders a desktop route from 640 px: the console scrolls sideways instead (founder decision 3)", () => {
    setWidth(1152);
    render(
      <DesktopOnly>
        <p>Console</p>
      </DesktopOnly>,
    );
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
    expect(screen.getByText("Console")).toBeTruthy();
  });

  it("shows only NeedsLargerWindow below 640 px on a desktop route", () => {
    setWidth(390);
    render(
      <DesktopOnly>
        <p>Sign in</p>
      </DesktopOnly>,
    );
    // WP-03 T3: no pixels for a person on a phone; the note carries its exits for this path.
    expect(screen.getByTestId("needs-larger-window").textContent).not.toContain("390 px");
    expect(screen.getByTestId("continue-later").dataset).toMatchObject({ path: "/b/x/today", signedIn: "true" });
    expect(screen.queryByText("Sign in")).toBeNull();
  });

  it("renders the page from 640 px up, and again when the window is widened", () => {
    setWidth(600);
    render(
      <DesktopOnly>
        <p>Sign in</p>
      </DesktopOnly>,
    );
    expect(screen.queryByText("Sign in")).toBeNull();
    setWidth(640);
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
  });

  it("a project's public page and a person's public profile work from 390 px: the one list of small-screen routes, nothing else changes", () => {
    expect(SMALL_SCREEN_PREFIXES).toEqual(["/p/", "/u/", "/m/", "/login", "/home", "/a/", "/email/pause", "/terms", "/privacy", "/", "/new/card/", "/onboarding", "/new/write", "/public-profile", "/network", "/communities", "/communities/", "/profiles/", "/i/", "/start"]);
    expect(worksOnSmallScreens("/new/card/11111111-1111-4111-8111-111111111111")).toBe(true);
    // The three questions after a kept card (WP-04 T1): exactly /onboarding, so a phone goes on from the card.
    expect(worksOnSmallScreens("/onboarding")).toBe(true);
    // A phone start without a card (WP-04 T15): exactly /new/write; the doors and the studio stay desktop.
    expect(worksOnSmallScreens("/new/write")).toBe(true);
    expect(worksOnSmallScreens("/new/write/")).toBe(true);
    for (const p of ["/new", "/new/write/x", "/new/ideate"]) expect(worksOnSmallScreens(p), p).toBe(false);
    // The signed-in index (WP-03 T1): what it renders in place (the landing page, the gate's pages) works from 390 px.
    expect(worksOnSmallScreens("/start")).toBe(true);
    // The landing page's hero (founder, 2026-11-13): exactly "/", never a prefix of every path.
    expect(worksOnSmallScreens("/")).toBe(true);
    for (const p of ["/b/x/today", "/b/x", "/new/ideate", "/onboarding/x", "/startx", "/start/x"]) expect(worksOnSmallScreens(p), p).toBe(false);
    // The Terms and the Privacy Policy (founder, 2026-11-13): exactly those two paths.
    expect(worksOnSmallScreens("/terms")).toBe(true);
    expect(worksOnSmallScreens("/privacy")).toBe(true);
    for (const p of ["/terms/x", "/privacy/x", "/termsx"]) expect(worksOnSmallScreens(p), p).toBe(false);
    // An invitation (THESIS_REVIEW 3.1) works from 390 px; nothing about waiting has a route of its own.
    expect(worksOnSmallScreens("/i/AbC_123-xyz")).toBe(true);
    expect(worksOnSmallScreens("/waitlist")).toBe(false);
    // The pages an email opens (founder, 2026-11-12): the one-click answer and the pause page, and nothing beside them.
    expect(worksOnSmallScreens("/a/AbC_123-xyz")).toBe(true);
    expect(worksOnSmallScreens("/email/pause")).toBe(true);
    for (const p of [
      "/a",
      "/a/",
      "/email",
      "/email/unsubscribe",
      "/email/pause-all",
      "/email/pauses",
    ])
      expect(worksOnSmallScreens(p), p).toBe(false);
    expect(worksOnSmallScreens("/p/northwind-skincare")).toBe(true);
    expect(worksOnSmallScreens("/u/maya-okafor")).toBe(true);
    // A project's story hangs under its page; a milestone's card has its own prefix (docs/NETWORK.md F2, F3).
    expect(worksOnSmallScreens("/p/northwind-skincare/story")).toBe(true);
    expect(worksOnSmallScreens("/m/7a21e15f-87b0-4000-ac49-c98b9d627e98")).toBe(true);
    for (const p of [
      "/loginx",
      "/profiles",
      "/p",
      "/u",
      "/m",
      "/milestones",
      "/messages",
      "/public-profile/x",
      "/b/x/today",
      "/b/x/milestones",
      null,
    ])
      expect(worksOnSmallScreens(p), String(p)).toBe(false);
    pathname = "/p/northwind-skincare";
    setWidth(390);
    render(
      <DesktopOnly>
        <p>Northwind</p>
      </DesktopOnly>,
    );
    expect(screen.getByText("Northwind")).toBeTruthy();
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
  });

  it("the sign-in page works from 390 px: its form, notices and Continue with Google render at every width", () => {
    expect(worksOnSmallScreens("/login")).toBe(true);
    expect(worksOnSmallScreens("/login/")).toBe(true);
    pathname = "/login";
    setWidth(390);
    render(
      <DesktopOnly>
        <p>Sign in</p>
      </DesktopOnly>,
    );
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
  });

  it("a page that says it works on small screens (the on_waitlist panel) is kept at 390 px on any route, and only while it is there", async () => {
    // A desktop-only route (`/start` itself works from 390 px since WP-03 T1).
    pathname = "/new";
    setWidth(390);
    const page = (marked: boolean) => (
      <DesktopOnly>
        {marked ? <WorksOnSmallScreens /> : null}
        <p>{marked ? "You're on the list." : "Start something"}</p>
      </DesktopOnly>
    );
    // As a person arrives: the server's page, then hydration before the width is measured.
    const container = document.createElement("div");
    container.innerHTML = renderToString(page(true));
    document.body.appendChild(container);
    let root!: ReturnType<typeof hydrateRoot>;
    await act(async () => {
      root = hydrateRoot(container, page(true));
    });
    expect(container.textContent).toContain("You're on the list.");
    expect(container.querySelector('[data-testid="needs-larger-window"]')).toBeNull();
    // A page without the mark on the same route asks for a larger window again.
    await act(async () => {
      root.render(page(false));
    });
    expect(container.querySelector('[data-testid="needs-larger-window"]')).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("package 2.1: a project's Today and Needs you, the person's profile and the people pages work from 390 px; the rest of a project does not", () => {
    const B = "/b/6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
    for (const p of [`${B}/today`, `${B}/today/`, `${B}/inbox`, `${B}/inbox/4c76f0d6-2afd-4bdd-adbf-2a82479eadf3`, "/public-profile", "/network", "/communities", "/communities/c1", "/profiles/founder/u1"]) expect(worksOnSmallScreens(p), p).toBe(true);
    for (const p of [`${B}/crm`, `${B}/settings/business`, `${B}/today/details`, `${B}/inbox/a/b`, "/b/not-a-uuid/today", "/networkx", "/profiles", "/b/"]) expect(worksOnSmallScreens(p), p).toBe(false);
  });

  it("WP-04 T6: Product › Public page works from 390 px, under whichever department holds it; no other department tab does", () => {
    const B = "/b/6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
    for (const p of [`${B}/d/product/public-page`, `${B}/d/product/public-page/`, `${B}/d/build/public-page`]) expect(worksOnSmallScreens(p), p).toBe(true);
    for (const p of [
      `${B}/d/product/vision`,
      `${B}/d/product/specification`,
      `${B}/d/product/roadmap`,
      `${B}/d/finance/wage-bill`,
      `${B}/d/team/squad`,
      `${B}/d/product/public-page/x`,
      `${B}/d/product/public-pages`,
      `${B}/d/public-page`,
      `${B}/d/product/public-page?view=x`,
      "/b/not-a-uuid/d/product/public-page",
    ])
      expect(worksOnSmallScreens(p), p).toBe(false);
  });

  it("WP-04 T2: Commit works from 390 px for one concept; the studio and the rest of /new do not", () => {
    const ID = "6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
    for (const p of [`/new/commit/${ID}`, `/new/commit/${ID}/`, `/new/commit/${ID.toUpperCase()}`]) expect(worksOnSmallScreens(p), p).toBe(true);
    for (const p of ["/new/commit", "/new/commit/", "/new/commit/not-a-uuid", `/new/commit/${ID}/x`, "/new", "/new/ideate", "/new/compare", "/new/import"]) expect(worksOnSmallScreens(p), p).toBe(false);
  });
});
