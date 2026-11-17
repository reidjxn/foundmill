/**
 * The Channel Board shows only channels that can really act (founder, 2026-11-11): the default view hides the ones the
 * API marks not available, Builder view lists them under "Not available yet" with the reason in plain words (and, for a
 * channel in offline tracking, the way to put it on the board), and a Board with nothing to show says what opens first.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { CHANNEL_KEYS, type ChannelKey } from "@foundmill/shared/constants";
import type { ChannelAvailabilityRow } from "@foundmill/shared/channel-availability";
import { CampaignsScreen } from "../CampaignsScreen";
import { ChannelsScreen } from "../ChannelsScreen";
import { FormationScreen, benchLabelFor } from "../FormationScreen";
import { NOT_AVAILABLE_INTRO, OFFLINE_TRACKING_OFFER, ON_BOARD_NOT_RUNNING, PUT_ON_WITH_OFFLINE_LABEL } from "../NotAvailableChannels";
import { buildChannelViews, channelShown, splitByAvailability } from "../channel-data";
import type { ChannelsListResponse } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, channelsList, dataResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d1", animateEntrance: false, rescoreDelayMs: 0 };

const ACTS: ChannelAvailabilityRow = { available: true, reason: "acts", sentence: null };
const NO_PUBLISHER: ChannelAvailabilityRow = { available: false, reason: "no_publisher", sentence: "Not available yet: the team cannot publish here yet." };
const CONNECT_GITHUB: ChannelAvailabilityRow = { available: false, reason: "not_connected", connectorKey: "github", connectable: true, sentence: "Not available yet: connect GitHub in Settings › Integrations and the team can run this." };
const SENDGRID_OFF: ChannelAvailabilityRow = { available: false, reason: "not_connected", connectorKey: "sendgrid", connectable: false, sentence: "Not available yet: SendGrid is not switched on for your project yet. Nothing is waiting on you." };

/** A person's own project on staging: `available` are the channels that act; SEO and GEO wait for GitHub, the rest have no publisher. */
function listWith(available: readonly ChannelKey[], over: Partial<Record<ChannelKey, ChannelAvailabilityRow>> = {}): ChannelsListResponse {
  const availability = Object.fromEntries(
    CHANNEL_KEYS.map((k) => [k, over[k] ?? (available.includes(k) ? ACTS : k === "seo" || k === "geo" ? CONNECT_GITHUB : k === "email_automation" ? SENDGRID_OFF : NO_PUBLISHER)]),
  ) as Record<ChannelKey, ChannelAvailabilityRow>;
  return {
    ...channelsList,
    channels: channelsList.channels.map((c) => ({ ...c, engineWorkflowId: c.enabled ? `engine:${c.id}` : null, recommended: c.recommended && availability[c.channelKey].available, availability: availability[c.channelKey] })),
    availability,
    noChannel: available.length === 0 ? "No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you." : null,
  };
}
const responses = (list: ChannelsListResponse) => ({ ...dataResponses, "distribution.channels.list": list });

describe("which channels are shown", () => {
  it("a channel is shown when it is available, or on the board in offline tracking; a missing answer hides nothing", () => {
    expect(channelShown({ enabled: false, kitMode: false, availability: ACTS })).toBe(true);
    expect(channelShown({ enabled: true, kitMode: false, availability: NO_PUBLISHER })).toBe(false);
    expect(channelShown({ enabled: false, kitMode: true, availability: NO_PUBLISHER })).toBe(false);
    expect(channelShown({ enabled: true, kitMode: true, availability: NO_PUBLISHER })).toBe(true);
    expect(channelShown({ enabled: false, kitMode: false })).toBe(true);
    const views = buildChannelViews({ channels: channelsList.channels, currency: "EUR" });
    expect(splitByAvailability(views).shown).toHaveLength(15);
  });

  it("a channel with no stored row takes its availability from the response's map, and is never recommended while unavailable", () => {
    const list = listWith(["email_automation"]);
    const views = buildChannelViews({ channels: list.channels.map((c) => ({ ...c, recommended: true })), currency: "EUR", availability: list.availability, recommendation: [{ channel: "paid_ads", fit: 18, potential: 4, recommended: true, cpa_range_minor: null, why: "x" }] });
    const { shown, unavailable } = splitByAvailability(views);
    // Email acts; print is on the board in offline tracking.
    expect(shown.map((v) => v.channelKey).sort()).toEqual(["email_automation", "print"]);
    expect(unavailable).toHaveLength(13);
    expect(views.find((v) => v.channelKey === "outdoor")?.availability.reason).toBe("no_publisher");
    expect(views.filter((v) => v.recommended).map((v) => v.channelKey)).toEqual(["email_automation"]);
  });

  it("the tray says how many channels can run", () => {
    expect(benchLabelFor(15)).toBe("All 15 channels are available");
    expect(benchLabelFor(3)).toBe("3 channels can run now");
    expect(benchLabelFor(1)).toBe("1 channel can run now");
  });
});

describe("the Board", () => {
  it("default view: only the channels that can run are tokens, and nothing says what is missing", () => {
    const fake = createFakeSource({ businessId: BID, responses: responses(listWith(["email_automation", "seo", "geo"])) });
    renderScreen(fake, <FormationScreen {...props} />, { builder: false });
    const board = screen.getByRole("region", { name: "Channel Board" });
    // Email, SEO and GEO act; print is on the board in offline tracking. Paid advertising and social are not tokens.
    expect(within(board).getAllByRole("button", { name: /fit \d+ of 20|not scored yet/ })).toHaveLength(4);
    expect(within(board).queryByRole("button", { name: /^Paid advertising/ })).toBeNull();
    expect(within(board).queryByRole("button", { name: /^Social media/ })).toBeNull();
    expect(within(board).getByRole("button", { name: /^Email automation/ }).getAttribute("aria-pressed")).toBe("true");
    expect(within(board).getByRole("group", { name: /^Off the board: 4 channels can run now/ })).toBeTruthy();
    expect(screen.getByText("2 of 4 running")).toBeTruthy();
    // WP-08 T9: "Not now" is shown to everyone, collapsed, with the week-one reason.
    const notNow = screen.getByTestId("channels-not-available");
    expect(within(notNow).getByText("Not now")).toBeTruthy();
    expect(within(notNow).getByText("Show 11 channels for later")).toBeTruthy();
    expect((notNow.querySelector('[data-channel-unavailable="paid_ads"]') as HTMLElement).textContent).toContain("Paid ads start when there is a budget and a page that sells.");
    expect(screen.queryByText(/of 15/)).toBeNull();
  });

  it("Builder view: the rest are listed under Not now, each with its reason in plain words", () => {
    const fake = createFakeSource({ businessId: BID, responses: responses(listWith(["email_automation"])) });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    expect(within(board).queryByRole("button", { name: /^Paid advertising/ })).toBeNull();
    const panel = screen.getByTestId("channels-not-available");
    expect(within(panel).getByText("Not now")).toBeTruthy();
    expect(within(panel).getByText("13 channels")).toBeTruthy();
    expect(within(panel).getByText(NOT_AVAILABLE_INTRO)).toBeTruthy();
    const rows = within(panel).getAllByRole("listitem");
    expect(rows).toHaveLength(13);
    const row = (key: string) => panel.querySelector(`[data-channel-unavailable="${key}"]`) as HTMLElement;
    expect(row("social").getAttribute("data-reason")).toBe("no_publisher");
    expect(row("social").textContent).toContain("Not available yet: the team cannot publish here yet.");
    expect(row("seo").textContent).toContain("Not available yet: connect GitHub in Settings › Integrations and the team can run this.");
    // A channel that was on the board before and cannot run says so, and can be taken off.
    expect(within(row("paid_ads")).getByText(ON_BOARD_NOT_RUNNING)).toBeTruthy();
    expect(within(row("paid_ads")).getByRole("button", { name: "Take off the board" })).toBeTruthy();
    // Nothing on a channel that has no way to run.
    expect(within(row("influencer")).queryByRole("button")).toBeNull();
    // The words never name another person or a fault.
    expect(panel.textContent).not.toMatch(/staff|seat|cofounder|your fault|failed/i);
  });

  it("Builder view: the founder's own step opens Settings › Integrations", () => {
    const fake = createFakeSource({ businessId: BID, responses: responses(listWith(["email_automation"])) });
    renderScreen(fake, <FormationScreen {...props} />);
    const row = screen.getByTestId("channels-not-available").querySelector('[data-channel-unavailable="seo"]') as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Open Integrations" }));
    expect(fake.navigations.at(-1)).toMatch(/settings.*integrations/);
  });

  it("Builder view: a channel in offline tracking can be put on the board from the list", async () => {
    const list = listWith(["email_automation"]);
    const offBoard = { ...list, channels: list.channels.map((c) => (c.channelKey === "print" ? { ...c, enabled: false, engineWorkflowId: null } : c)) };
    const fake = createFakeSource({ businessId: BID, responses: responses(offBoard) });
    renderScreen(fake, <FormationScreen {...props} />);
    const row = screen.getByTestId("channels-not-available").querySelector('[data-channel-unavailable="print"]') as HTMLElement;
    expect(row.textContent).toContain(OFFLINE_TRACKING_OFFER);
    expect(within(row).getByText("Offline tracking")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: PUT_ON_WITH_OFFLINE_LABEL }));
    });
    expect(fake.mutations).toContainEqual({ path: "distribution.channels.enable", input: { channelKey: "print" } });
    expect(fake.refetches["distribution.channels.list"]).toBeGreaterThan(0);
  });

  it("no channel can run: an honest empty state, no board, no recommendation button", () => {
    const list = listWith([]);
    const none = { ...list, channels: list.channels.map((c) => ({ ...c, enabled: false, engineWorkflowId: null })) };
    const fake = createFakeSource({ businessId: BID, responses: responses(none) });
    renderScreen(fake, <FormationScreen {...props} />, { builder: false });
    const empty = screen.getByTestId("board-no-channels");
    expect(within(empty).getByText("No channels to run yet")).toBeTruthy();
    expect(empty.textContent).toContain("No channel can run on its own yet. Email opens first, as soon as sending is switched on for your project. Nothing is wrong, and nothing is waiting on you.");
    expect(screen.queryByRole("region", { name: "Channel Board" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Get recommendation|Score again/ })).toBeNull();
    expect(screen.queryByTestId("board-caption")).toBeNull();
    expect(screen.queryByText(/of 15|of 0/)).toBeNull();
    expect(within(screen.getByTestId("channels-not-available")).getAllByRole("listitem")).toHaveLength(15);
  });

  it("no channel can run, Builder view: the empty state and all fifteen under Not available yet", () => {
    const list = listWith([]);
    const none = { ...list, channels: list.channels.map((c) => ({ ...c, enabled: false, engineWorkflowId: null })) };
    const fake = createFakeSource({ businessId: BID, responses: responses(none) });
    renderScreen(fake, <FormationScreen {...props} />);
    expect(screen.getByTestId("board-no-channels")).toBeTruthy();
    expect(within(screen.getByTestId("channels-not-available")).getAllByRole("listitem")).toHaveLength(15);
    expect(screen.getByTestId("channels-not-available").querySelector('[data-channel-unavailable="email_automation"]')?.textContent).toContain("Nothing is waiting on you.");
  });

  it("every channel available (a sample business, development, test): the Board is as before", () => {
    const all = listWith([...CHANNEL_KEYS]);
    const fake = createFakeSource({ businessId: BID, responses: responses(all) });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    expect(within(board).getAllByRole("button", { name: /fit \d+ of 20|not scored yet/ })).toHaveLength(15);
    expect(within(board).getByRole("group", { name: /^Off the board: All 15 channels are available/ })).toBeTruthy();
    expect(screen.getByText("4 of 15 running")).toBeTruthy();
    expect(screen.queryByTestId("channels-not-available")).toBeNull();
    expect(screen.queryByTestId("board-no-channels")).toBeNull();
  });
});

describe("the Channels table", () => {
  it("rows only for channels that can run; the Not now list in every view", () => {
    const list = listWith(["email_automation", "seo"]);
    const founder = createFakeSource({ businessId: BID, responses: responses(list) });
    const first = renderScreen(founder, <ChannelsScreen {...props} />, { builder: false });
    const table = screen.getByRole("grid", { name: "Channels" });
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + email, SEO, print (offline tracking)
    expect(within(table).queryByText("Paid advertising")).toBeNull();
    expect(screen.getByText(/2 on the board · 3 of 3 scored/)).toBeTruthy();
    expect(within(screen.getByTestId("channels-not-available")).getAllByRole("listitem")).toHaveLength(12);
    first.unmount();

    const builder = createFakeSource({ businessId: BID, responses: responses(list) });
    renderScreen(builder, <ChannelsScreen {...props} />);
    expect(within(screen.getByRole("grid", { name: "Channels" })).getAllByRole("row")).toHaveLength(4);
    expect(within(screen.getByTestId("channels-not-available")).getAllByRole("listitem")).toHaveLength(12);
  });

  it("no channel can run: the table says what opens first and offers no recommendation", () => {
    const list = listWith([]);
    const none = { ...list, channels: list.channels.map((c) => ({ ...c, enabled: false, engineWorkflowId: null })) };
    const fake = createFakeSource({ businessId: BID, responses: responses(none) });
    renderScreen(fake, <ChannelsScreen {...props} />, { builder: false });
    expect(screen.getByText("No channels to run yet")).toBeTruthy();
    expect(screen.getByText(/Email opens first, as soon as sending is switched on for your project/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Get recommendation|Score again/ })).toBeNull();
  });
});

describe("the Campaigns screen", () => {
  it("a new campaign cannot be started while no channel on the board can run", () => {
    const list = listWith([]);
    const stuck = { ...list, channels: list.channels.map((c) => ({ ...c, kitMode: false })) };
    const fake = createFakeSource({ businessId: BID, responses: responses(stuck) });
    renderScreen(fake, <CampaignsScreen {...props} />);
    const button = document.querySelector("[data-new-campaign]") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("title")).toBe("Put a channel on the board first");
  });
});
