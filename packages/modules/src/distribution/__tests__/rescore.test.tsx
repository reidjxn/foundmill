/**
 * Re-scoring after toggles (BUILD §11.7, AC-11.7.2; audit P7): the Board shows local scores at once and the Strategist
 * (`distribution.recommend`, a model call) re-scores once, a short while after the last toggle, instead of once per
 * toggle. A re-score still waiting when the screen is left runs then.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { FormationScreen } from "../FormationScreen";
import { localScores, MAX_STARTERS, RESCORE_DEBOUNCE_MS } from "../rescore";
import { createFakeSource, renderScreen } from "./fake-source";
import { BID, dataResponses, recommendResponse } from "./fixtures";

const onMutate = (path: string) => (path === "distribution.recommend" ? recommendResponse : {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const recommends = (fake: { mutations: { path: string }[] }) => fake.mutations.filter((m) => m.path === "distribution.recommend").length;

describe("localScores", () => {
  const view = (channelKey: string, fit: number, enabled: boolean, recommended = false, scored = true) => ({ channelKey, fit, enabled, recommended, scored }) as never as Parameters<typeof localScores>[0][number];

  it("puts the channels on the Board first, tops up to three by fit, and keeps fits as they were", () => {
    const out = localScores([view("seo", 11, true), view("paid_ads", 17, false, true), view("social", 16, false), view("print", 6, false), view("pr", 5, false, false, false)]);
    expect(out.filter((v) => v.recommended).map((v) => v.channelKey)).toEqual(["seo", "paid_ads", "social"]);
    expect(out.map((v) => v.fit)).toEqual([11, 17, 16, 6, 5]);
    // A channel never scored stays as it was.
    expect(out.at(-1)!.recommended).toBe(false);
  });

  it("caps the starters at six, keeping the best fits on the Board", () => {
    const many = Array.from({ length: 8 }, (_, i) => view(`c${i}`, 10 + i, true));
    const out = localScores(many);
    expect(out.filter((v) => v.recommended)).toHaveLength(MAX_STARTERS);
    expect(out.find((v) => (v.channelKey as string) === "c0")!.recommended).toBe(false);
    expect(out.find((v) => (v.channelKey as string) === "c7")!.recommended).toBe(true);
  });

  it("is deterministic and waits two seconds by default", () => {
    const input = [view("a", 9, true), view("b", 9, false), view("c", 3, false)];
    expect(localScores(input)).toEqual(localScores(input));
    expect(RESCORE_DEBOUNCE_MS).toBe(2_000);
  });
});

describe("FormationScreen re-score after toggles", () => {
  it("shows local scores at once and re-scores once after a run of toggles", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    renderScreen(fake, <FormationScreen businessId={BID} departmentId="d1" animateEntrance={false} rescoreDelayMs={700} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^SEO, fit 11/ }), { key: " " });
    });
    // On the Board at once, a starter by the local scores, with no model call yet.
    const seo = within(board).getByRole("button", { name: /^SEO, fit 11/ });
    expect(seo.getAttribute("aria-pressed")).toBe("true");
    expect(seo.getAttribute("aria-label")).toContain("recommended");
    expect(screen.getByTestId("rescore-pending").textContent).toMatch(/Local scores/);
    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^Content marketing, fit 12/ }), { key: " " });
    });
    expect(recommends(fake)).toBe(0);
    await waitFor(() => expect(recommends(fake)).toBe(1), { timeout: 5_000 });
    expect(fake.mutations.map((m) => m.path)).toEqual(["distribution.channels.enable", "distribution.channels.enable", "distribution.recommend"]);
    await waitFor(() => expect(screen.queryByTestId("rescore-pending")).toBeNull());
    await act(async () => {
      await sleep(900);
    });
    expect(recommends(fake)).toBe(1);
  }, 15_000);

  it("Re-score runs at once and drops the waiting one; leaving the screen runs a waiting re-score", async () => {
    const fake = createFakeSource({ businessId: BID, responses: dataResponses, onMutate });
    const view = renderScreen(fake, <FormationScreen businessId={BID} departmentId="d1" animateEntrance={false} rescoreDelayMs={10_000} />);
    const board = screen.getByRole("region", { name: "Channel Board" });
    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^SEO, fit 11/ }), { key: " " });
    });
    expect(recommends(fake)).toBe(0);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Re-score" }));
    });
    await waitFor(() => expect(recommends(fake)).toBe(1));
    expect(screen.queryByTestId("rescore-pending")).toBeNull();

    await act(async () => {
      fireEvent.keyDown(within(board).getByRole("button", { name: /^Content marketing, fit 12/ }), { key: " " });
    });
    expect(recommends(fake)).toBe(1);
    view.unmount();
    await waitFor(() => expect(recommends(fake)).toBe(2));
  });
});
