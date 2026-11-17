/**
 * Product › Site › Pay buttons (WP-07 T7): lists the project's payment links, marks a simulated one, and lets an owner
 * or an admin add and remove links; read-only for everyone else.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { PAY_LINK_WORDS, PayLinksPanel, type PayLinkViewResponse } from "../PayLinksPanel";
import { SiteScreen, type SiteViewResponse } from "../SiteScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID } from "./fixtures";

const link = (over: Partial<PayLinkViewResponse> = {}): PayLinkViewResponse => ({ id: "l1", key: "starter-kit", label: "Starter kit", priceMinor: null, currency: null, url: "https://buy.stripe.com/test_1", source: "pasted", simulated: false, createdAt: "2026-11-16T12:00:00Z", ...over });
const render = (links: PayLinkViewResponse[], canEdit: boolean, onMutate?: (path: string, input: Record<string, unknown>) => unknown) => {
  const fake = createFakeSource({ businessId: BID, responses: { "payLink.list": links }, onMutate });
  renderScreen(fake, <PayLinksPanel canEdit={canEdit} />);
  return fake;
};

describe("PayLinksPanel", () => {
  it("says there are no links yet and offers to add one", async () => {
    render([], true);
    expect(await screen.findByText(PAY_LINK_WORDS.empty)).toBeTruthy();
    expect(screen.getByText(PAY_LINK_WORDS.help)).toBeTruthy();
    expect(screen.getByTestId("pay-link-add")).toBeTruthy();
  });

  it("lists links and marks a simulated one as not shown on the site", async () => {
    render([link(), link({ id: "l2", key: "sim", label: "Simulated", source: "stripe", simulated: true })], true);
    expect((await screen.findByTestId("pay-link-starter-kit")).textContent).toContain("/_fm/pay/starter-kit");
    expect(screen.getByTestId("pay-link-sim").textContent).toContain(PAY_LINK_WORDS.simulated);
  });

  it("adds a link with its name and address, and removes one", async () => {
    const calls: [string, Record<string, unknown>][] = [];
    render([link()], true, (path, input) => {
      calls.push([path, input]);
      return [];
    });
    await act(async () => fireEvent.click(await screen.findByTestId("pay-link-add")));
    fireEvent.change(screen.getByLabelText(PAY_LINK_WORDS.label), { target: { value: "Coffee" } });
    fireEvent.change(screen.getByLabelText(PAY_LINK_WORDS.url), { target: { value: "https://buy.stripe.com/test_2" } });
    await act(async () => fireEvent.click(screen.getByTestId("pay-link-save")));
    await act(async () => fireEvent.click(screen.getByTestId("pay-link-remove")));
    expect(calls).toEqual([
      ["payLink.add", { label: "Coffee", url: "https://buy.stripe.com/test_2" }],
      ["payLink.archive", { id: "l1" }],
    ]);
  });

  it("is read-only for someone who cannot edit", async () => {
    render([link()], false);
    expect(await screen.findByText(PAY_LINK_WORDS.readOnly)).toBeTruthy();
    expect(screen.queryByTestId("pay-link-add")).toBeNull();
    expect(screen.queryByTestId("pay-link-remove")).toBeNull();
  });
});

describe("SiteScreen › Pay buttons", () => {
  const site: SiteViewResponse = { enabled: true, site: { slug: "lunchbox", status: "draft", url: "https://lunchbox.sites.example/", liveReleaseNumber: null, publishedAt: null }, releases: [], canPublish: true };
  it("shows the panel once the project has a site, and not before", async () => {
    renderScreen(createFakeSource({ businessId: BID, responses: { "site.get": site, "payLink.list": [] } }), <SiteScreen businessId={BID} departmentId="d1" />);
    expect(await screen.findByTestId("pay-links")).toBeTruthy();
  });
  it("has no panel without a site", async () => {
    renderScreen(createFakeSource({ businessId: BID, responses: { "site.get": { ...site, site: null }, "payLink.list": [] } }), <SiteScreen businessId={BID} departmentId="d1" />);
    await screen.findByTestId("site-empty");
    expect(screen.queryByTestId("pay-links")).toBeNull();
  });
});
