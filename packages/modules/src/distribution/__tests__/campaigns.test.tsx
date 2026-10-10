import "./setup";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CampaignsScreen } from "../CampaignsScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { ASSET, BID, CAMPAIGN, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d1" };

describe("CampaignsScreen", () => {
  it("lists campaigns with channel, status, budget and asset approval counts, and shows the first one's detail", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CampaignsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Campaigns" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Launch week on Meta")).toBeTruthy();
    expect(within(table).getByText("Paid advertising")).toBeTruthy();
    expect(within(table).getByText("Live")).toBeTruthy();
    expect(within(table).getByText("0 of 2 approved")).toBeTruthy();
    expect(within(table).getByText("1 of 1 approved")).toBeTruthy();
    expect(within(table).getByText("0 of 1 approved")).toBeTruthy();
    expect(within(table).getByText("1 awaiting")).toBeTruthy();
    expect(within(table).getByText("1 rejected")).toBeTruthy();
    expect(screen.getByText(/3 campaigns · 1 live · 1 awaiting approval/)).toBeTruthy();

    const detail = screen.getByRole("region", { name: "Launch week on Meta" });
    expect(within(detail).getByText(/Reach 2,000 skincare shoppers/)).toBeTruthy();
    const assets = within(detail).getByRole("region", { name: "Assets" });
    expect(within(assets).getByText("Glow serum carousel")).toBeTruthy();
    expect(within(assets).getByText("Awaiting approval")).toBeTruthy();
    expect(within(assets).getByText("Rejected")).toBeTruthy();
    expect(within(assets).getAllByRole("link", { name: /Mara/ })).toHaveLength(2);
    expect(within(detail).getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(within(detail).getByRole("button", { name: "End campaign" })).toBeTruthy();
    expect(within(detail).queryByRole("button", { name: "Launch" })).toBeNull();
  });

  it("approves and rejects assets through distribution.assets.approve/reject", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({}) });
    renderScreen(fake, <CampaignsScreen {...props} />);
    const assets = screen.getByRole("region", { name: "Assets" });
    await act(async () => {
      fireEvent.click(within(assets).getByRole("button", { name: "Approve Glow serum carousel" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.assets.approve", input: { assetId: ASSET.ad } });
    expect(fake.refetches["distribution.assets.list"]).toBe(1);
    await act(async () => {
      fireEvent.click(within(assets).getByRole("button", { name: "Reject Glow serum carousel" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.assets.reject", input: { assetId: ASSET.ad } });
  });

  it("changes status from the detail buttons and the right-click verbs, blocking launch until an asset is approved", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({}) });
    renderScreen(fake, <CampaignsScreen {...props} />);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("region", { name: "Launch week on Meta" })).getByRole("button", { name: "Pause" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: CAMPAIGN.launch, status: "paused" } });
    expect(fake.refetches["distribution.campaigns.list"]).toBe(1);

    const table = screen.getByRole("grid", { name: "Campaigns" });
    fireEvent.click(within(table).getByText("Spring routine series"));
    const spring = await screen.findByRole("region", { name: "Spring routine series" });
    expect(within(spring).getByRole("button", { name: "Resume" })).toBeTruthy();

    fireEvent.click(within(table).getByText("Welcome sequence"));
    const welcome = await screen.findByRole("region", { name: "Welcome sequence" });
    expect(within(welcome).getByRole("button", { name: "Submit for approval" })).toBeTruthy();
    expect(within(welcome).queryByRole("button", { name: "Launch" })).toBeNull();

    fireEvent.contextMenu(within(table).getByText("Spring routine series"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Launch" }).getAttribute("aria-disabled")).toBe("true");
    expect(within(menu).getByRole("menuitem", { name: "Pause" }).getAttribute("aria-disabled")).toBe("true");
    await user.click(within(menu).getByRole("menuitem", { name: "Resume" }));
    await waitFor(() => expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: CAMPAIGN.spring, status: "live" } }));
  });

  it("blocks launch of a scheduled campaign whose assets are all unapproved", () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.campaigns.list": { items: [{ id: CAMPAIGN.launch, channelId: "x", name: "Scheduled one", goal: "", status: "scheduled", budgetMinor: 100, currency: "EUR", startsAt: null, endsAt: null }], nextCursor: null } } });
    renderScreen(fake, <CampaignsScreen {...props} />);
    const detail = screen.getByRole("region", { name: "Scheduled one" });
    expect((within(detail).getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(detail).getByText("Launch needs at least one approved asset.")).toBeTruthy();
  });

  it("shows the empty state, the error and the loading skeleton", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(empty, <CampaignsScreen {...props} />);
    expect(screen.getByText("No campaigns yet")).toBeTruthy();
    expect(screen.getByText(/Pick a campaign/)).toBeTruthy();

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "distribution.campaigns.list": new Error("campaigns down") } });
    renderScreen(failing, <CampaignsScreen {...props} />);
    expect(screen.getByText("campaigns down")).toBeTruthy();

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <CampaignsScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
