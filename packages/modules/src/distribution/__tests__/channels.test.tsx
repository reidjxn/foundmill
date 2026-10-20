import "./setup";
import { describe, expect, it } from "vitest";
import userEvent from "@testing-library/user-event";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { ChannelsScreen } from "../ChannelsScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, CHANNEL, dataResponses, emptyResponses, recommendResponse } from "./fixtures";

// The Strategist re-scores right after a toggle here; rescore.test.tsx covers the two-second wait.
const props = { businessId: BID, departmentId: "d1", rescoreDelayMs: 0 };
const onMutate = (path: string) => (path === "distribution.recommend" ? recommendResponse : {});

describe("ChannelsScreen", () => {
  it("lists all 15 channels with line, fit, potential stars, cost range, budget, status and the offline-tracking chip", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ChannelsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Channels" });
    expect(within(table).getAllByRole("row")).toHaveLength(16); // header + 15
    expect(within(table).getByText("Paid advertising")).toBeTruthy();
    expect(within(table).getAllByText("Acquisition").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Running")).toHaveLength(3);
    expect(within(table).getByText("Paused")).toBeTruthy(); // social: only campaign paused
    expect(within(table).getAllByText("Not scored")).toHaveLength(9);
    expect(within(table).getAllByText("Off the board")).toHaveLength(2);
    expect(within(table).getAllByText("Offline tracking").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("Recommended")).toHaveLength(3);
    expect(within(table).getAllByText("Estimate").length).toBeGreaterThan(0);
    expect(within(table).getByLabelText(/Paid advertising potential/)).toBeTruthy();
    expect(screen.getByText(/4 on the board · 6 of 15 scored/)).toBeTruthy();
  });

  it("guidance on: opens on the Simple view (Channel, Fit, Status, Cost per customer) and defines the words it uses (UX plan §7.10)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ChannelsScreen {...props} />, { guidance: "on" });
    const table = screen.getByRole("grid", { name: "Channels" });
    expect(screen.getByRole("button", { name: /^View: Simple/ })).toBeTruthy();
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Channel", "Fit", "Status", "Cost per customer", "Actions"]);
    expect(within(table).getAllByRole("row")).toHaveLength(16);
    expect(within(table).queryByText("Acquisition")).toBeNull(); // Family waits in the other views
    // The panel's help tip and the footer's defined words (the column head's sort button shares the words, so the
    // defined one is told by its dotted underline).
    expect(screen.getByRole("button", { name: "About Channels" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Cost per customer" }).filter((b) => b.className.includes("term-link"))).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Distribution Strategist" }).className).toContain("term-link");
  });

  it("guidance off: opens on All channels with plain words and no help tip", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ChannelsScreen {...props} />);
    expect(screen.getByRole("button", { name: /^View: All channels/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "About Channels" })).toBeNull();
    expect(document.querySelector(".term-link")).toBeNull();
    expect(screen.queryByRole("button", { name: "Distribution Strategist" })).toBeNull();
  });

  it("switches saved views: Running shows only the three running channels", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ChannelsScreen {...props} />);
    await user.click(screen.getByRole("button", { name: /All channels/ }));
    await user.click(await screen.findByRole("menuitemradio", { name: /^Running/ }));
    const table = screen.getByRole("grid", { name: "Channels" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(5));
    // The Running view carries the cost trend (the Board tokens' five-cell strip) with its words for assistive tech.
    expect(within(table).getByRole("columnheader", { name: /Cost trend/ })).toBeTruthy();
    expect(within(table).getAllByRole("list", { name: /cost trend, last five weeks/ }).length).toBeGreaterThan(0);
    expect(within(table).queryByRole("columnheader", { name: /^Form$/ })).toBeNull();
  });

  it("the Score again button and the refresh chip read in plain words", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ChannelsScreen {...props} />);
    expect(screen.getByRole("button", { name: "Score again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Re-score" })).toBeNull();
  });

  it("offers right-click verbs: move to bench → disable + re-score, pause → campaigns.setStatus, set budget → channels.budget", async () => {
    const user = userEvent.setup();
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    renderScreen(fake, <ChannelsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Channels" });
    fireEvent.contextMenu(within(table).getByText("Paid advertising"));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "Open profile" })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: "Take off the board" }));
    await waitFor(() => expect(fake.mutations.map((m) => m.path)).toEqual(["distribution.channels.disable", "distribution.recommend"]));

    fireEvent.contextMenu(within(table).getByText("Paid advertising"));
    const menu2 = await screen.findByRole("menu");
    await user.click(within(menu2).getByRole("menuitem", { name: "Pause campaigns" }));
    await waitFor(() => expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: expect.any(String), status: "paused" } }));

    fireEvent.contextMenu(within(table).getByText("SEO"));
    const menu3 = await screen.findByRole("menu");
    expect(within(menu3).getByRole("menuitem", { name: "Move to Board" })).toBeTruthy();
    expect(within(menu3).getByRole("menuitem", { name: "Pause campaigns" }).getAttribute("aria-disabled")).toBe("true");
    await user.click(within(menu3).getByRole("menuitem", { name: "Set budget…" }));
    const dialog = await screen.findByRole("dialog", { name: "Set budget" });
    fireEvent.change(within(dialog).getByLabelText("Monthly budget"), { target: { value: "250" } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Save budget" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.channels.budget", input: { channelId: CHANNEL.seo, budgetMinor: 25000, currency: "EUR" } });
  });

  it("opens the profile on the Formation tab from the keyboard (ArrowDown to the best-fit row, Enter)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <ChannelsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Channels" });
    fireEvent.keyDown(table, { key: "ArrowDown" });
    fireEvent.keyDown(table, { key: "Enter" });
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/distribution/formation?channel=paid_ads`);
  });

  it("shows every channel as Not scored before the first recommendation, and handles loading and error", () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses });
    renderScreen(empty, <ChannelsScreen {...props} />);
    const table = screen.getByRole("grid", { name: "Channels" });
    expect(within(table).getAllByText("Not scored")).toHaveLength(15);
    expect(screen.getByRole("button", { name: "Get recommendation" })).toBeTruthy();

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "distribution.channels.list": new Error("list down") } });
    renderScreen(failing, <ChannelsScreen {...props} />);
    expect(screen.getByText("list down")).toBeTruthy();

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <ChannelsScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});
