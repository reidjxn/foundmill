import "./setup";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { CampaignsScreen } from "../CampaignsScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { ASSET, BID, CAMPAIGN, CHANNEL, assets, dataResponses, emptyResponses } from "./fixtures";

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
    expect(within(detail).getByRole("button", { name: "End campaign…" })).toBeTruthy();
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

  it("holds the approved-asset rule in the row actions and for a campaign with no assets at all", async () => {
    const scheduled = (id: string, name: string) => ({ id, channelId: "x", name, goal: "", status: "scheduled", budgetMinor: 100, currency: "EUR", startsAt: null, endsAt: null });
    const fake = createFakeSource({
      businessId: BID,
      responses: {
        ...dataResponses,
        "distribution.campaigns.list": { items: [scheduled("c-bare", "No assets yet"), scheduled(CAMPAIGN.welcome, "Has a draft")], nextCursor: null },
        "distribution.assets.list": [assets[2]],
      },
      onMutate: () => ({}),
    });
    renderScreen(fake, <CampaignsScreen {...props} />);
    // Detail: no assets is no excuse (the API refuses the same launch).
    const detail = screen.getByRole("region", { name: "No assets yet" });
    expect((within(detail).getByRole("button", { name: "Launch" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(detail).getByText("Launch needs at least one approved asset.")).toBeTruthy();
    // Row actions: the same rule on the right-click menu, for both campaigns.
    const table = screen.getByRole("grid", { name: "Campaigns" });
    for (const name of ["No assets yet", "Has a draft"]) {
      fireEvent.contextMenu(within(table).getByText(name));
      const menu = await screen.findByRole("menu");
      expect(within(menu).getByRole("menuitem", { name: "Launch" }).getAttribute("aria-disabled")).toBe("true");
      fireEvent.keyDown(menu, { key: "Escape" });
    }
  });

  it("launches once an asset is approved, and resume restores a campaign paused while scheduled", async () => {
    const user = userEvent.setup();
    const approved = { ...assets[2]!, approvalState: "approved" as const };
    const ready = { id: CAMPAIGN.welcome, channelId: "x", name: "Ready one", goal: "", status: "scheduled", budgetMinor: 100, currency: "EUR", startsAt: null, endsAt: null, config: {} };
    const paused = { id: CAMPAIGN.spring, channelId: "x", name: "Paused one", goal: "", status: "paused", budgetMinor: 100, currency: "EUR", startsAt: null, endsAt: null, config: { pausedFrom: "scheduled" } };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.campaigns.list": { items: [ready, paused], nextCursor: null }, "distribution.assets.list": [approved] }, onMutate: () => ({}) });
    renderScreen(fake, <CampaignsScreen {...props} />);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("region", { name: "Ready one" })).getByRole("button", { name: "Launch" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: CAMPAIGN.welcome, status: "live" } });
    // Paused while scheduled: Resume puts it back to scheduled (it never went live), not live.
    const table = screen.getByRole("grid", { name: "Campaigns" });
    fireEvent.contextMenu(within(table).getByText("Paused one"));
    await user.click(await screen.findByRole("menuitem", { name: "Resume" }));
    await waitFor(() => expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: CAMPAIGN.spring, status: "scheduled" } }));
  });

  it("asks before ending a campaign (ending is final), from the detail and from the menu", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({}) });
    renderScreen(fake, <CampaignsScreen {...props} />);
    fireEvent.click(within(screen.getByRole("region", { name: "Launch week on Meta" })).getByRole("button", { name: "End campaign…" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Ending is final/)).toBeTruthy();
    expect(fake.mutations).toHaveLength(0);
    // Keeping it running changes nothing.
    await user.click(within(dialog).getByRole("button", { name: "Keep it running" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fake.mutations).toHaveLength(0);
    // The right-click verb asks the same question; confirming ends it.
    const table = screen.getByRole("grid", { name: "Campaigns" });
    fireEvent.contextMenu(within(table).getByText("Launch week on Meta"));
    await user.click(await screen.findByRole("menuitem", { name: "End campaign…" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End campaign" }));
    await waitFor(() => expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: CAMPAIGN.launch, status: "ended" } }));
  });

  it("creates a campaign and edits one (name, objective, budget, dates) over campaigns.create / update", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: (path) => (path === "distribution.campaigns.create" ? { id: "c-new", name: "Autumn push" } : {}) });
    renderScreen(fake, <CampaignsScreen {...props} />);
    await user.click(screen.getByRole("button", { name: "New campaign" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create campaign" }));
    expect(within(dialog).getByText("Give the campaign a name.")).toBeTruthy();
    expect(fake.mutations).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Name/), "Autumn push");
    await user.type(within(dialog).getByLabelText(/Objective/), "Win 20 first orders");
    await user.type(within(dialog).getByLabelText(/Budget/), "2500");
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-10-20" } });
    fireEvent.change(within(dialog).getByLabelText(/Ends/), { target: { value: "2026-11-20" } });
    await user.click(within(dialog).getByRole("button", { name: "Create campaign" }));
    await waitFor(() => expect(fake.mutations.at(-1)?.path).toBe("distribution.campaigns.create"));
    const created = fake.mutations.at(-1)!.input as Record<string, unknown>;
    expect(created).toMatchObject({ channelId: CHANNEL.paid, name: "Autumn push", goal: "Win 20 first orders", budgetMinor: 250000, currency: "EUR" });
    expect(new Date(created.startsAt as string).getFullYear()).toBe(2026);
    expect(created.status).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fake.refetches["distribution.campaigns.list"]).toBe(1);

    // Edit from the detail: the form opens on the campaign's own values and saves a patch.
    await user.click(within(screen.getByRole("region", { name: "Launch week on Meta" })).getByRole("button", { name: "Edit" }));
    dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText(/Name/) as HTMLInputElement;
    expect(name.value).toBe("Launch week on Meta");
    expect((within(dialog).getByLabelText(/Budget/) as HTMLInputElement).value).toMatch(/600/);
    await user.clear(name);
    await user.type(name, "Launch fortnight on Meta");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.mutations.at(-1)?.path).toBe("distribution.campaigns.update"));
    expect(fake.mutations.at(-1)!.input).toMatchObject({ campaignId: CAMPAIGN.launch, patch: { name: "Launch fortnight on Meta", budgetMinor: 60000, currency: "EUR" } });
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
