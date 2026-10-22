import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FormationScreen } from "../FormationScreen";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, CAMPAIGN, CHANNEL, channelsList, dataResponses, emptyResponses, recommendResponse } from "./fixtures";

// The Strategist re-scores right after a toggle here; rescore.test.tsx covers the two-second wait.
const props = { businessId: BID, departmentId: "d1", animateEntrance: false, rescoreDelayMs: 0 };
const onMutate = (path: string) => (path === "distribution.recommend" ? recommendResponse : {});

describe("FormationScreen", () => {
  it("guidance on: the department's intro sits in the Board's body and Fit is a defined word in the caption (UX plan §7.10, §7.13)", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <FormationScreen {...props} />, { guidance: "on" });
    const panel = screen.getByRole("region", { name: "Board" });
    const explainer = panel.querySelector("[data-explainer='distribution/board']") as HTMLElement;
    expect(explainer).toBeTruthy();
    expect(within(explainer).getByText("How customers will find you.")).toBeTruthy();
    expect(within(explainer).getByText("Cost per customer is an Estimate until the ad platform reports which customers it actually brought.")).toBeTruthy();
    const caption = screen.getByTestId("board-caption");
    expect(caption.textContent).toBe("Fit 1–20: how well a channel suits this business, scored by the Distribution Strategist. Closer to the center means a better fit.");
    expect(within(caption).getByRole("button", { name: "Fit" }).className).toContain("term-link");
    expect(within(panel).getByRole("button", { name: "About Board" })).toBeTruthy();
    // "Got it" collapses the intro to one line.
    fireEvent.click(within(explainer).getByRole("button", { name: "Got it" }));
    expect((panel.querySelector("[data-explainer='distribution/board']") as HTMLElement).getAttribute("data-state")).toBe("collapsed");
  });

  it("guidance off: no intro, the caption's words are plain", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <FormationScreen {...props} />);
    expect(document.querySelector("[data-explainer]")).toBeNull();
    expect(screen.getByTestId("board-caption").textContent).toBe("Fit 1–20: how well a channel suits this business, scored by the Distribution Strategist. Closer to the center means a better fit.");
    expect(screen.queryByRole("button", { name: "Fit" })).toBeNull();
  });

  it("renders every channel as a token: the running ones on the Board, the rest off the board, with fit and recommendation", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    // What fit is, once, under the title (UX plan §7.13).
    expect(screen.getByTestId("board-caption").textContent).toBe("Fit 1–20: how well a channel suits this business, scored by the Distribution Strategist. Closer to the center means a better fit.");
    // Six channels carry a stored score; the other nine were never scored and say so instead of showing a default fit.
    expect(within(board).getAllByRole("button", { name: /fit \d+ of 20/ })).toHaveLength(6);
    expect(within(board).getAllByRole("button", { name: /not scored yet/ })).toHaveLength(9);
    const paid = within(board).getByRole("button", { name: /^Paid advertising, fit 17 of 20/ });
    expect(paid.getAttribute("aria-pressed")).toBe("true");
    expect(paid.getAttribute("aria-label")).toContain("recommended");
    const seo = within(board).getByRole("button", { name: /^SEO, fit 11 of 20/ });
    expect(seo.getAttribute("aria-pressed")).toBe("false");
    expect(within(board).getByRole("group", { name: /^Off the board: All 15 channels are available/ })).toBeTruthy();
    expect(screen.getByText("4 of 15 running")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Score again" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Re-score" })).toBeNull();
  });

  it("never counts a channel without an engine as running: it reads 'starting' (audit GTM-01)", () => {
    const withoutEngine = { ...channelsList, channels: channelsList.channels.map((c, i) => ({ ...c, engineWorkflowId: c.enabled && i === 0 ? null : c.enabled ? `engine:${c.id}` : null })) };
    const fake = createFakeSource({ businessId: BID, responses: { ...dataResponses, "distribution.channels.list": withoutEngine } });
    renderScreen(fake, <FormationScreen {...props} />);
    expect(screen.getByText("3 of 15 running · 1 starting")).toBeTruthy();
  });

  it("moves a channel to the bench with Enter → disable, then re-scores through distribution.recommend and refetches", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    const paid = within(board).getByRole("button", { name: /^Paid advertising, fit 17/ });
    await act(async () => {
      fireEvent.keyDown(paid, { key: "Enter" });
    });
    await waitFor(() => expect(fake.mutations.map((m) => m.path)).toEqual(["distribution.channels.disable", "distribution.recommend"]));
    expect(fake.mutations[0]!.input).toEqual({ channelKey: "paid_ads" });
    await waitFor(() => expect(fake.refetches["distribution.channels.list"]).toBe(1));
    // The recommendation's fit (18) replaces the stored one once it arrives.
    await waitFor(() => expect(within(board).getByRole("button", { name: /^Paid advertising, fit 18/ })).toBeTruthy());
  });

  it("moves a bench channel onto the Board with the enable procedure", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^SEO, fit 11/ }), { key: " " });
    });
    await waitFor(() => expect(fake.mutations[0]).toEqual({ path: "distribution.channels.enable", input: { channelKey: "seo" } }));
  });

  it("opens the channel profile with O: agents, budget editor, rules, campaigns and why; saves the budget", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^Paid advertising, fit 17/ }), { key: "o" });
    });
    const rail = screen.getByRole("complementary", { name: "Paid advertising" });
    expect(within(rail).getAllByText("Mara").length).toBeGreaterThan(0);
    expect(within(rail).getByText("Recommended")).toBeTruthy();
    expect(within(rail).getByText("Launch week on Meta")).toBeTruthy();
    const rules = within(rail).getByRole("region", { name: "Rules" });
    expect(within(rules).getByText(/Daily and lifetime caps/)).toBeTruthy();
    expect(within(rail).getByRole("region", { name: "Why this channel" })).toBeTruthy();
    expect(within(rail).getAllByText(/Estimate/).length).toBeGreaterThan(0);

    const budget = within(rail).getByLabelText("Monthly budget") as HTMLInputElement;
    expect(budget.value).toBe("1,200"); // grouped at rest; the € symbol and the EUR code sit beside it
    expect(within(rail).getByText("EUR")).toBeTruthy();
    fireEvent.change(budget, { target: { value: "1500" } });
    await act(async () => {
      fireEvent.click(within(rail).getByRole("button", { name: "Save budget" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.channels.budget", input: { channelId: CHANNEL.paid, budgetMinor: 150000, currency: "EUR" } });
    expect(fake.refetches["distribution.channels.list"]).toBe(1);

    fireEvent.click(within(rail).getByRole("button", { name: "Open in Channels" }));
    expect(fake.navigations[0]).toBe(`/b/${BID}/d/distribution/channels?channel=paid_ads`);
  });

  it("pauses a channel by pausing its live campaigns and resumes them again", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    renderScreen(fake, <FormationScreen {...props} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^Paid advertising, fit 17/ }), { key: "O" });
    });
    const rail = screen.getByRole("complementary", { name: "Paid advertising" });
    await act(async () => {
      fireEvent.click(within(rail).getByRole("button", { name: "Pause" }));
    });
    expect(fake.mutations.at(-1)).toEqual({ path: "distribution.campaigns.setStatus", input: { campaignId: CAMPAIGN.launch, status: "paused" } });
    expect(fake.refetches["distribution.campaigns.list"]).toBe(1);
  });

  it("asks for the first recommendation when nothing is scored, and handles loading and error", async () => {
    const empty = createFakeSource({ businessId: BID, responses: emptyResponses, onMutate });
    renderScreen(empty, <FormationScreen {...props} />);
    expect(screen.getByRole("status").textContent).toContain("All 15 channels are off the board");
    expect(screen.getByRole("status").textContent).toContain("picks 3 to 6 channels to start with");
    expect(screen.getByRole("status").textContent).not.toMatch(/starters/);
    expect(screen.getByRole("region", { name: "Channel Board" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /not scored yet/ })).toHaveLength(15);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Get recommendation" }));
    });
    expect(empty.mutations[0]!.path).toBe("distribution.recommend");
    await waitFor(() => expect(screen.getByRole("button", { name: /^Paid advertising, fit 18/ })).toBeTruthy());

    const failing = createFakeSource({ businessId: BID, responses: { ...emptyResponses, "distribution.channels.list": new Error("channels down") } });
    renderScreen(failing, <FormationScreen {...props} />);
    expect(screen.getByText("channels down")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(failing.refetches["distribution.channels.list"]).toBe(1);

    const loading = createFakeSource({ businessId: BID });
    const { container } = renderScreen(loading, <FormationScreen {...props} />);
    expect(container.querySelector("[aria-busy='true']")).toBeTruthy();
  });

  it("refetches on campaign.launched events", () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses });
    renderScreen(fake, <FormationScreen {...props} />);
    act(() => {
      fake.emit({ type: "campaign.launched", payload: {} });
    });
    expect(fake.refetches["distribution.channels.list"]).toBe(1);
    expect(fake.refetches["distribution.campaigns.list"]).toBe(1);
  });
});
