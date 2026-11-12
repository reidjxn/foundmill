// @vitest-environment happy-dom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { viewport } from "../../../app/layout";
import { DesktopOnly, SMALL_SCREEN_PREFIXES, worksOnSmallScreens } from "../DesktopOnly";

let pathname = "/login";
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
    pathname = "/login";
  });

  it("does not force a 1280 px layout viewport: the meta keeps Next's device-width, so a phone reports its real width", () => {
    expect((viewport as { width?: unknown }).width).toBeUndefined();
  });

  it("shows only NeedsLargerWindow below 1280 px, the sign-in page's notices included", () => {
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
    expect(SMALL_SCREEN_PREFIXES).toEqual(["/p/", "/u/"]);
    expect(worksOnSmallScreens("/p/northwind-skincare")).toBe(true);
    expect(worksOnSmallScreens("/u/maya-okafor")).toBe(true);
    for (const p of ["/", "/login", "/profiles", "/p", "/u", "/public-profile", "/b/x/today", null]) expect(worksOnSmallScreens(p), String(p)).toBe(false);
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
});
