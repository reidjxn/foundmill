import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { CreativeScreen } from "../CreativeScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { ASSET, BID, dataResponses, emptyResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d1" };

describe("CreativeScreen", () => {
  it("groups assets by kind with campaign, author, approval state and a preview link", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CreativeScreen {...props} />);
    expect(screen.getByRole("region", { name: "Emails" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Posts" })).toBeTruthy();
    const ads = screen.getByRole("region", { name: "Ads" });
    const card = within(ads).getByRole("article", { name: "Glow serum carousel" });
    expect(within(card).getByText("Launch week on Meta")).toBeTruthy();
    expect(within(card).getByRole("link", { name: /Mara/ })).toBeTruthy();
    expect(within(card).getByText("Awaiting approval")).toBeTruthy();
    // The drafted copy is on the card, so the founder reads what they approve.
    expect(within(card).getByTestId("asset-body").textContent).toContain("Calm skin by Friday");
    const opened: string[] = [];
    const original = window.open;
    window.open = ((url: string) => {
      opened.push(url);
      return null;
    }) as typeof window.open;
    fireEvent.click(within(card).getByRole("button", { name: "Preview Glow serum carousel" }));
    window.open = original;
    expect(opened).toEqual(["https://assets.example.com/ad-1"]);
    const videos = screen.getByRole("region", { name: "Videos" });
    expect(within(videos).getByText("Rejected")).toBeTruthy();
    expect(within(videos).queryByRole("button", { name: /Approve/ })).toBeNull();
    const emails = screen.getByRole("region", { name: "Emails" });
    expect(within(emails).getByText("Author unknown")).toBeTruthy();
    expect(within(emails).getByText("drive://welcome-1")).toBeTruthy();
    expect(screen.getByText("4 assets · 1 awaiting approval")).toBeTruthy();
  });

  it("filters by approval state with the chips", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <CreativeScreen {...props} />);
    const filters = screen.getByRole("group", { name: "Filter by approval state" });
    fireEvent.click(within(filters).getByText("Approved"));
    expect(screen.queryByRole("region", { name: "Ads" })).toBeNull();
    expect(screen.getByRole("region", { name: "Posts" })).toBeTruthy();
    fireEvent.click(within(filters).getByText("Rejected"));
    expect(screen.getByRole("region", { name: "Videos" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Posts" })).toBeNull();
    fireEvent.click(within(filters).getByText("All"));
    expect(screen.getByRole("region", { name: "Posts" })).toBeTruthy();
  });

  it("approves and rejects through distribution.assets.approve/reject and refetches", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate: () => ({}) });
    renderScreen(fake, <CreativeScreen {...props} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve Glow serum carousel" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.assets.approve", input: { assetId: ASSET.ad } });
    expect(fake.refetches["distribution.assets.list"]).toBe(1);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reject Welcome to Northwind" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.assets.reject", input: { assetId: ASSET.email } });
  });

  it("shows the empty state, the error and the loading skeleton", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    const { unmount } = renderScreen(empty, <CreativeScreen {...props} />);
    expect(screen.getByText("No creative yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open campaigns" }));
    expect(empty.navigations).toHaveLength(1);
    unmount();

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "distribution.assets.list": new Error("assets down") } });
    renderScreen(failing, <CreativeScreen {...props} />);
    expect(screen.getByText("assets down")).toBeTruthy();

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <CreativeScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
