/**
 * The founder views say what is true without a repository or a release (WP-02 T5): nothing is live from here, there
 * are no previews, and the team's code has nowhere to go live until a repository is connected.
 */
import "./setup";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LiveProduct, WhatChanged, waitingFooter } from "../founder-views";
import { BUSINESS_ID, createFakeSource, renderScreen } from "./fake-source";

const now = new Date("2026-11-15T12:00:00Z");
const base = { businessId: BUSINESS_ID, deptSlug: "development", loading: false, onRetry: () => undefined, now };

describe("Live product with no release recorded", () => {
  it("points to the public page and says previews are not available yet", () => {
    renderScreen(createFakeSource({ responses: {} }), <LiveProduct {...base} live={null} previews={[]} publicPageHref="/b/x/product/public-page" />);
    expect(screen.getByTestId("live-product-card").textContent).toContain("Nothing is live from here yet. Your public page is the first thing people can open: Product › Public page.");
    expect(screen.getByTestId("live-product-public-page").getAttribute("href")).toBe("/b/x/product/public-page");
    expect(screen.getByText("Previews are not available yet.")).toBeTruthy();
    expect(screen.queryByText(/address of your live product/)).toBeNull();
  });

  it("keeps the preview promise once a release exists", () => {
    renderScreen(createFakeSource({ responses: {} }), <LiveProduct {...base} live={{ url: "https://app.example", updatedAt: now }} previews={[]} />);
    expect(screen.getByText(/Each change gets its own preview to try before it goes live/)).toBeTruthy();
  });
});

describe("What changed with nowhere to push", () => {
  it("says the code is saved in the project and how to connect a repository", () => {
    renderScreen(createFakeSource({ responses: {} }), <WhatChanged {...base} open={[]} live={[]} destination="none" />);
    expect(screen.getByText(waitingFooter("none"))).toBeTruthy();
    expect(waitingFooter("none")).toBe("The team's code is saved in your project. It has nowhere to go live yet: connect a GitHub repository in Settings › Integrations to have it pushed there for you to approve.");
    expect(waitingFooter("github")).toMatch(/^Nothing goes live until you say so/);
    expect(screen.queryByText(/Nothing goes live until you say so/)).toBeNull();
  });
});
