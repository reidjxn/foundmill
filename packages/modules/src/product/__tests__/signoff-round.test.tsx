/** The sign-off banner's line (docs/DESIGN.md "Builder view"): the round number is Builder view's. */
import "./setup";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SignoffBanner, useSignoffs } from "../signoff";
import type { SignoffViews } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";

const views: SignoffViews = {
  stage: "awaiting_signoff",
  spec: { id: "s1", kind: "spec", round: 2, status: "pending", requestedAt: "2026-11-07T09:00:00.000Z", decidedAt: null, decidedBy: null, notes: null, specVersion: null, inboxItemId: "i1" },
  roadmap: null,
  readyToSell: null,
};

function Banner() {
  return <SignoffBanner kind="spec" signoffs={useSignoffs()} canWrite />;
}

describe("SignoffBanner", () => {
  it("with Builder view off the line has no round number", async () => {
    renderScreen(createFakeSource({ responses: { "product.signoff.get": views } }), <Banner />, {}, { builder: false });
    const banner = await screen.findByTestId("signoff-banner");
    expect(banner.textContent).toContain("Read the specification and approve it");
    expect(banner.textContent).not.toMatch(/Round \d/);
  });

  it("with Builder view on it names the round", async () => {
    renderScreen(createFakeSource({ responses: { "product.signoff.get": views } }), <Banner />);
    expect((await screen.findByTestId("signoff-banner")).textContent).toContain("Round 2: read the specification");
  });
});
