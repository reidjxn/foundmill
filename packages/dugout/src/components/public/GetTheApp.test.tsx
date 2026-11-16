import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET_THE_APP_WORDS, GetTheApp } from "./GetTheApp";

const IOS = "https://apps.apple.com/us/app/foundmill/id1234567890";
const ANDROID = "https://play.google.com/store/apps/details?id=com.foundmill.app";

describe("GetTheApp", () => {
  it("renders nothing without links (the value is unset until the app launches)", () => {
    expect(renderToStaticMarkup(<GetTheApp links={null} />)).toBe("");
    expect(renderToStaticMarkup(<GetTheApp links={{ ios: null, android: null }} />)).toBe("");
  });

  it("links to each store that is set, iPhone first", () => {
    render(<GetTheApp links={{ ios: IOS, android: ANDROID }} />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual([GET_THE_APP_WORDS.ios, GET_THE_APP_WORDS.android]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual([IOS, ANDROID]);
    for (const a of links) expect(a.className).toContain("min-h-tap");
  });

  it("shows one link when only one store is set", () => {
    render(<GetTheApp links={{ ios: null, android: ANDROID }} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: GET_THE_APP_WORDS.android }).getAttribute("href")).toBe(ANDROID);
  });
});
