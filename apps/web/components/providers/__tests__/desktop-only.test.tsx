// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viewport } from "../../../app/layout";
import { DesktopOnly, SMALL_SCREEN_PREFIXES, worksOnSmallScreens } from "../DesktopOnly";

let pathname = "/b/x/today";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

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

  it("does not force a 1280 px layout viewport: the meta keeps Next's device-width, so a phone reports its real width", () => {
    expect((viewport as { width?: unknown }).width).toBeUndefined();
  });

  it("shows only NeedsLargerWindow below 1280 px on a desktop route", () => {
    setWidth(390);
    render(
      <DesktopOnly>
        <p>Sign in</p>
      </DesktopOnly>,
    );
    expect(screen.getByTestId("needs-larger-window").textContent).toContain("390 px");
    expect(screen.queryByText("Sign in")).toBeNull();
  });

  it("renders the page from 1280 px up, and again when the window is widened", () => {
    setWidth(1000);
    render(
      <DesktopOnly>
        <p>Sign in</p>
      </DesktopOnly>,
    );
    expect(screen.queryByText("Sign in")).toBeNull();
    setWidth(1280);
    expect(screen.getByText("Sign in")).toBeTruthy();
    expect(screen.queryByTestId("needs-larger-window")).toBeNull();
  });

  it("a project's public page and a person's public profile work from 390 px: the one list of small-screen routes, nothing else changes", () => {
    expect(SMALL_SCREEN_PREFIXES).toEqual(["/p/", "/u/", "/login", "/home", "/a/", "/email/pause", "/terms", "/privacy", "/public-profile", "/network", "/communities", "/communities/", "/profiles/"]);
    // The Terms and the Privacy Policy (founder, 2026-11-13): exactly those two paths.
    expect(worksOnSmallScreens("/terms")).toBe(true);
    expect(worksOnSmallScreens("/privacy")).toBe(true);
    for (const p of ["/terms/x", "/privacy/x", "/termsx"]) expect(worksOnSmallScreens(p), p).toBe(false);
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
    for (const p of [
      "/",
      "/loginx",
      "/profiles",
      "/p",
      "/u",
      "/public-profile/x",
      "/b/x/today",
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

  it("package 2.1: a project's Today and Needs you, the person's profile and the people pages work from 390 px; the rest of a project does not", () => {
    const B = "/b/6f1d2c3b-4a5e-4f60-8a71-0b2c3d4e5f60";
    for (const p of [`${B}/today`, `${B}/today/`, `${B}/inbox`, `${B}/inbox/4c76f0d6-2afd-4bdd-adbf-2a82479eadf3`, "/public-profile", "/network", "/communities", "/communities/c1", "/profiles/founder/u1"]) expect(worksOnSmallScreens(p), p).toBe(true);
    for (const p of [`${B}/crm`, `${B}/settings/business`, `${B}/today/details`, `${B}/inbox/a/b`, "/b/not-a-uuid/today", "/networkx", "/profiles", "/b/"]) expect(worksOnSmallScreens(p), p).toBe(false);
  });
});
