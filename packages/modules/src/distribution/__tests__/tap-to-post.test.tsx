/**
 * Tap-to-post in Distribution (founder, 2026-11-12): the social channel is available on the Channel Board with no
 * connector, in the founder's words; on the board it reads "You post it" and is never counted as running; and a post
 * drafted for it carries "Share", which opens the share panel with the draft's words and, while the page is live, the
 * page's address with `via`. A press is recorded as a share that was opened, never as a post.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { CHANNEL_BY_TAP_SENTENCE, type ChannelAvailabilityRow } from "@foundmill/shared/channel-availability";
import { CHANNEL_KEYS, type ChannelKey } from "@foundmill/shared/constants";
import { encodeShareValue } from "@foundmill/shared/share-targets";
import { CreativeScreen, assetSharedByTap } from "../CreativeScreen";
import { FormationScreen, benchLabelFor } from "../FormationScreen";
import { CHANNEL_STATUS_WORDS, buildChannelViews, channelStatus, postedByTap, splitByAvailability, statusHint } from "../channel-data";
import type { AssetRow, ChannelsListResponse } from "../types";
import { createFakeSource, renderScreen } from "./fake-source";
import { ASSET, BID, CAMPAIGN, CHANNEL, channelsList, dataResponses } from "./fixtures";

const props = { businessId: BID, departmentId: "d1", animateEntrance: false, rescoreDelayMs: 0 };

const ACTS: ChannelAvailabilityRow = { available: true, reason: "acts", sentence: null };
const BY_TAP: ChannelAvailabilityRow = { available: true, reason: "by_tap", byTap: true, sentence: CHANNEL_BY_TAP_SENTENCE };
const SIMULATED: ChannelAvailabilityRow = { available: true, reason: "simulated_allowed", sentence: null };
const SIMULATED_TAP: ChannelAvailabilityRow = { available: true, reason: "simulated_allowed", byTap: true, sentence: CHANNEL_BY_TAP_SENTENCE };
const NO_PUBLISHER: ChannelAvailabilityRow = { available: false, reason: "no_publisher", sentence: "Not available yet: the team cannot publish here yet." };

/** A person's own project: `acts` are the channels the team runs, social is by tap, the rest have no publisher. */
function listWith(acts: readonly ChannelKey[], social: ChannelAvailabilityRow = BY_TAP, socialOnBoard = true): ChannelsListResponse {
  const availability = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, k === "social" ? social : acts.includes(k) ? ACTS : NO_PUBLISHER])) as Record<ChannelKey, ChannelAvailabilityRow>;
  return {
    ...channelsList,
    channels: channelsList.channels.map((c) => {
      const enabled = c.channelKey === "social" ? socialOnBoard : c.enabled;
      // A channel the founder posts by tap never has an engine.
      const engine = enabled && !(c.channelKey === "social" && social.reason === "by_tap") ? `engine:${c.id}` : null;
      return { ...c, enabled, engineWorkflowId: engine, recommended: c.recommended && availability[c.channelKey].available, availability: availability[c.channelKey] };
    }),
    availability,
    noChannel: null,
  };
}
const responses = (list: ChannelsListResponse) => ({ ...dataResponses, "distribution.channels.list": list });

describe("a channel the founder posts by tap", () => {
  it("is shown like any available channel, and reads \"You post it\" on the board whatever its engine field says", () => {
    const list = listWith(["email_automation"]);
    const views = buildChannelViews({ channels: list.channels, currency: "EUR", availability: list.availability });
    const { shown } = splitByAvailability(views);
    expect(shown.map((v) => v.channelKey)).toContain("social");
    const social = views.find((v) => v.channelKey === "social")!;
    expect(postedByTap(social)).toBe(true);
    expect(channelStatus(social)).toEqual({ tone: "neutral", word: "You post it" });
    // Never "Starting" (it has no engine to wait for), never "Running", before or after distribution starts.
    expect(channelStatus({ ...social, engineWorkflowId: null }, { distributionStarted: true }).word).toBe("You post it");
    expect(channelStatus({ ...social, engineWorkflowId: "engine:stale" }).word).toBe("You post it");
    expect(channelStatus(social, { distributionStarted: false }).word).toBe("You post it");
    expect(channelStatus({ ...social, enabled: false }).word).toBe("Off the board");
    expect(statusHint("You post it")).toBe(CHANNEL_BY_TAP_SENTENCE);
    expect(CHANNEL_STATUS_WORDS).toContain("You post it");
    // Simulated results (a development stack): the engine runs there, so it reads as it always did.
    expect(postedByTap({ availability: SIMULATED_TAP })).toBe(false);
    expect(channelStatus({ ...social, availability: SIMULATED_TAP, engineWorkflowId: "engine:x" }).word).toBe("Running");
  });

  it("is named apart in the tray's label, never as a channel that runs", () => {
    expect(benchLabelFor(3, 1)).toBe("2 channels can run now, 1 you post yourself");
    expect(benchLabelFor(2, 1)).toBe("1 channel can run now, 1 you post yourself");
    expect(benchLabelFor(1, 1)).toBe("1 channel you post yourself");
    expect(benchLabelFor(3)).toBe("3 channels can run now");
    expect(benchLabelFor(15, 0)).toBe("All 15 channels are available");
  });
});

describe("the Board", () => {
  it("shows social as available with the by-tap sentence, and never counts it as running", () => {
    const fake = createFakeSource({ businessId: BID, responses: responses(listWith(["email_automation"])) });
    renderScreen(fake, <FormationScreen {...props} />, { builder: false });
    const board = screen.getByRole("region", { name: "Channel Board" });
    // A token like any available channel, on the board.
    expect(within(board).getByRole("button", { name: /^Social media/ }).getAttribute("aria-pressed")).toBe("true");
    const note = screen.getByTestId("board-by-tap");
    const row = note.querySelector('[data-channel="social"]') as HTMLElement;
    expect(row.getAttribute("data-reason")).toBe("by_tap");
    expect(row.textContent).toBe(`Social media${CHANNEL_BY_TAP_SENTENCE}`);
    expect(within(row).getByText("You post each one with one press: the text and link are filled in for you.")).toBeTruthy();
    // Email, social and print (offline tracking) are shown; email and print run, social is the founder's.
    expect(screen.getByText("2 of 3 running · 1 you post")).toBeTruthy();
    expect(within(board).getByRole("group", { name: /^Off the board: 2 channels can run now, 1 you post yourself/ })).toBeTruthy();
    // Not in "Not now", and nothing says it was posted.
    expect(screen.getByTestId("channels-not-available").querySelector('[data-channel-unavailable="social"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/\bposted\b/i);
  });

  it("with only social available the Board is not empty: it is there to put on, in the founder's words", () => {
    const list = listWith([], BY_TAP, false);
    const none = { ...list, channels: list.channels.map((c) => ({ ...c, enabled: false, kitMode: false, engineWorkflowId: null })) };
    const fake = createFakeSource({ businessId: BID, responses: responses(none) });
    renderScreen(fake, <FormationScreen {...props} />, { builder: false });
    expect(screen.queryByTestId("board-no-channels")).toBeNull();
    const board = screen.getByRole("region", { name: "Channel Board" });
    expect(within(board).getAllByRole("button", { name: /fit \d+ of 20|not scored yet/ })).toHaveLength(1);
    expect(within(board).getByRole("button", { name: /^Social media/ }).getAttribute("aria-pressed")).toBe("false");
    expect(within(board).getByRole("group", { name: /^Off the board: 1 channel you post yourself/ })).toBeTruthy();
    expect(screen.getByTestId("board-by-tap").textContent).toContain(CHANNEL_BY_TAP_SENTENCE);
    expect(screen.getByText("0 of 1 running")).toBeTruthy();
  });

  it("Builder view lists the other channels as not available, and never social", () => {
    const fake = createFakeSource({ businessId: BID, responses: responses(listWith(["email_automation"])) });
    renderScreen(fake, <FormationScreen {...props} />);
    const panel = screen.getByTestId("channels-not-available");
    expect(panel.querySelector('[data-channel-unavailable="social"]')).toBeNull();
    expect(panel.querySelector('[data-channel-unavailable="paid_ads"]')).not.toBeNull();
  });

  it("where simulated results are allowed the sentence is still said, and the channel runs as before", () => {
    const all = Object.fromEntries(CHANNEL_KEYS.map((k) => [k, k === "social" ? SIMULATED_TAP : SIMULATED])) as Record<ChannelKey, ChannelAvailabilityRow>;
    const list: ChannelsListResponse = { ...channelsList, channels: channelsList.channels.map((c) => ({ ...c, engineWorkflowId: c.enabled ? `engine:${c.id}` : null, availability: all[c.channelKey] })), availability: all, noChannel: null };
    const fake = createFakeSource({ businessId: BID, responses: responses(list) });
    renderScreen(fake, <FormationScreen {...props} />, { builder: false });
    const row = screen.getByTestId("board-by-tap").querySelector('[data-channel="social"]') as HTMLElement;
    expect(row.getAttribute("data-reason")).toBe("simulated_allowed");
    expect(row.textContent).toContain(CHANNEL_BY_TAP_SENTENCE);
    expect(screen.getByText("4 of 15 running")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Channel Board" })).getByRole("group", { name: /^Off the board: All 15 channels are available/ })).toBeTruthy();
  });

  it("says nothing of the kind once a connector publishes (the team posts)", () => {
    const fake = createFakeSource({ businessId: BID, responses: responses(listWith(["email_automation"], ACTS)) });
    renderScreen(fake, <FormationScreen {...props} />, { builder: false });
    expect(screen.queryByTestId("board-by-tap")).toBeNull();
    expect(screen.getByText("3 of 3 running")).toBeTruthy();
  });
});

describe("Creative: Share on a post drafted for social", () => {
  const BODY = "Morning routine, day one.\nThree steps, no fragrance.";
  const assets = (over: Partial<AssetRow> = {}): AssetRow[] => (dataResponses["distribution.assets.list"] as AssetRow[]).map((a) => (a.id === ASSET.post ? { ...a, body: BODY, ...over } : a));
  const livePage = { url: "https://foundmill.example/p/northwind-skincare", slug: "northwind-skincare", live: true, isSample: false, published: { pitch: "Refillable skincare for sensitive skin" }, preview: { name: "Northwind Skincare" } };
  const LINK = "https://foundmill.example/p/northwind-skincare?via=p.northwind-skincare";
  const open = (network: string) => document.querySelector(`a[data-share-open="${network}"]`) as HTMLAnchorElement;

  it("knows which drafts can be shared by tap: a post with words, not rejected, of a channel posted by tap", () => {
    const campaigns = [{ id: CAMPAIGN.spring, channelId: CHANNEL.social }, { id: CAMPAIGN.launch, channelId: CHANNEL.paid }];
    const tap = new Set([CHANNEL.social]);
    const post = { kind: "post" as const, body: BODY, approvalState: "pending" as const, campaignId: CAMPAIGN.spring };
    expect(assetSharedByTap(post, campaigns, tap)).toBe(true);
    expect(assetSharedByTap({ ...post, approvalState: "approved" }, campaigns, tap)).toBe(true);
    expect(assetSharedByTap({ ...post, approvalState: "rejected" }, campaigns, tap)).toBe(false);
    expect(assetSharedByTap({ ...post, body: "  " }, campaigns, tap)).toBe(false);
    expect(assetSharedByTap({ ...post, body: null }, campaigns, tap)).toBe(false);
    expect(assetSharedByTap({ ...post, kind: "ad" }, campaigns, tap)).toBe(false);
    expect(assetSharedByTap({ ...post, campaignId: CAMPAIGN.launch }, campaigns, tap)).toBe(false);
    expect(assetSharedByTap({ ...post, campaignId: null }, campaigns, tap)).toBe(false);
    expect(assetSharedByTap(post, campaigns, new Set())).toBe(false);
  });

  it("offers Share on the social post only, and opens the panel with its words and the live page's address with via", async () => {
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.assets.list": assets(), "page.get": livePage } });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    expect(document.querySelectorAll("[data-asset-share]")).toHaveLength(1);
    const card = within(screen.getByRole("region", { name: "Posts" })).getByRole("article", { name: "Morning routine, day one" });
    fireEvent.click(within(card).getByRole("button", { name: "Share: Morning routine, day one" }));
    const dialog = await screen.findByRole("dialog", { name: "Share this post" });
    expect((within(dialog).getByLabelText("Text") as HTMLTextAreaElement).value).toBe(BODY);
    expect(dialog.querySelector("[data-share-link]")!.textContent).toBe(LINK);
    expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue(BODY)}&url=${encodeShareValue(LINK)}`);
    expect(new URL(open("bluesky").href).searchParams.get("text")).toBe(`${BODY}\n\n${LINK}`);
    // A press is recorded as a share that was opened: the control, never the words.
    await act(async () => {
      fireEvent.click(open("x"));
    });
    expect(fake.mutations).toEqual([{ path: "share.opened", input: { kind: "draft", network: "x", target: "tap" } }]);
    expect(JSON.stringify(fake.mutations)).not.toContain("Morning");
    // The draft is not approved, launched or marked as anything by the press.
    expect(fake.mutations.some((m) => m.path.startsWith("distribution."))).toBe(false);
  });

  it("with no published page the post has no link: the networks that take text still open, and nothing is invented", async () => {
    for (const page of [{ ...livePage, live: false, published: null }, { ...livePage, isSample: true }, new Error("You cannot read this section")]) {
      const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.assets.list": assets(), "page.get": page } });
      const view = renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
      fireEvent.click(screen.getByRole("button", { name: "Share: Morning routine, day one" }));
      const dialog = await screen.findByRole("dialog", { name: "Share this post" });
      expect(dialog.querySelector("[data-share-link]")).toBeNull();
      expect(open("x").getAttribute("href")).toBe(`https://x.com/intent/post?text=${encodeShareValue(BODY)}`);
      expect(open("linkedin")).toBeNull();
      view.unmount();
    }
  });

  it("a share that cannot be recorded changes nothing on the screen", async () => {
    const fake = createFakeSource({
      businessId: BID,
      responses: { ...dataResponses, "distribution.assets.list": assets(), "page.get": livePage },
      onMutate: () => {
        throw new Error("offline");
      },
    });
    renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
    fireEvent.click(screen.getByRole("button", { name: "Share: Morning routine, day one" }));
    await screen.findByRole("dialog", { name: "Share this post" });
    await act(async () => {
      fireEvent.click(open("threads"));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Share this post" })).toBeTruthy();
    expect(open("threads").getAttribute("href")).toMatch(/^https:\/\/www\.threads\.com\/intent\/post\?text=/);
  });

  it("offers no Share on a rejected post or a post with no words", () => {
    for (const over of [{ approvalState: "rejected" as const }, { body: null }]) {
      const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.assets.list": assets(over), "page.get": livePage } });
      const view = renderScreen(fake, <CreativeScreen businessId={BID} departmentId="d1" />);
      expect(document.querySelector("[data-asset-share]")).toBeNull();
      view.unmount();
    }
  });
});
