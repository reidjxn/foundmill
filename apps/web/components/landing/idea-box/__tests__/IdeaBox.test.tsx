/**
 * The idea box on the landing page (docs/IDEA_BOX.md): the typing placeholder until the field is focused, Surprise me's
 * interests, a draft streamed into the card, the ways to keep it (the sign-in link carries the claim token), a
 * refusal's one line, and a browser that already holds a card landing on it.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { IDEA_BOX_INTERESTS, type IdeaBoxEvent } from "@foundmill/shared";
import { IdeaBox, IDEA_BOX_WORDS, keepHref } from "../IdeaBox";
import { streamIdeaDraft } from "../client";
import { PLACEHOLDER_IDEAS, TYPING } from "../typing";

const CLAIM = "c".repeat(43);
const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
const card = { id: "ff", name: "Firstframe", pitch: "Restored film cameras for first-time buyers.", archetype: "dtc_physical", stars_current: 3, stars_potential: 4, attributes: KEYS.map((key, i) => ({ key, value: 8 + i, evidence: `Why ${key}.` })), citations: [], crest_seed: "ff" };
const landedEvent: IdeaBoxEvent = { type: "card", card, prompt: "Restored film cameras", interest: null, sample: false, again: false, claim: CLAIM };

function ndjsonResponse(events: IdeaBoxEvent[], splitAt?: number): Response {
  const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const chunks = splitAt ? [text.slice(0, splitAt), text.slice(splitAt)] : [text];
  const enc = new TextEncoder();
  return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } }), { status: 200, headers: { "content-type": "application/x-ndjson" } });
}

let draftEvents: IdeaBoxEvent[] = [];
let mine: IdeaBoxEvent | null = null;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  draftEvents = [];
  mine = null;
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/idea-box/mine")) return mine ? new Response(JSON.stringify(mine), { status: 200 }) : new Response(null, { status: 204 });
    return ndjsonResponse(draftEvents);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const renderBox = (props: Parameters<typeof IdeaBox>[0] = {}) =>
  render(
    <TooltipProvider>
      <IdeaBox {...props} />
    </TooltipProvider>,
  );

describe("IdeaBox", () => {
  it("types ideas into the placeholder until the visitor focuses the field", async () => {
    vi.useFakeTimers();
    renderBox();
    await act(async () => {
      vi.advanceTimersByTime(TYPING.startMs + TYPING.typeMs * 4);
    });
    expect(screen.getByTestId("idea-placeholder").textContent).toBe(PLACEHOLDER_IDEAS[0].slice(0, 5));
    fireEvent.focus(screen.getByTestId("idea-input"));
    expect(screen.queryByTestId("idea-placeholder")).toBeNull();
  });

  it("Surprise me opens the interests", () => {
    renderBox();
    fireEvent.click(screen.getByTestId("idea-surprise"));
    const list = screen.getByTestId("idea-interests");
    expect(list.querySelectorAll("button")).toHaveLength(IDEA_BOX_INTERESTS.length);
  });

  it("streams the card in and offers to keep it, the sign-in link carrying the claim token", async () => {
    const onLanded = vi.fn();
    draftEvents = [{ type: "started" }, { type: "partial", card: { name: "Firstframe", pitch: card.pitch } }, { type: "rating", index: 0, rating: card.attributes[0]! }, landedEvent];
    renderBox({ onLanded });
    fireEvent.change(screen.getByTestId("idea-input"), { target: { value: "Restored film cameras" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    await waitFor(() => expect(screen.getByTestId("idea-keep")).toBeTruthy());
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/idea-box/draft"))!;
    expect(init).toMatchObject({ method: "POST", credentials: "include" });
    expect(JSON.parse(init.body)).toEqual({ prompt: "Restored film cameras", interest: null, turnstile: "mock-ok", website: "" });
    expect(screen.getByRole("heading", { level: 2, name: "Firstframe" })).toBeTruthy();
    expect(screen.getByTestId("idea-keep-email").getAttribute("href")).toBe(keepHref(CLAIM));
    expect(keepHref(CLAIM)).toBe(`/login?next=${encodeURIComponent(`/start?claim=${CLAIM}`)}`);
    expect(onLanded).toHaveBeenLastCalledWith({ name: "Firstframe", prompt: "Restored film cameras", interest: null });
    expect(screen.getByText(IDEA_BOX_WORDS.waits)).toBeTruthy();
  });

  it("shows a refusal's one line under the field and stays ready", async () => {
    draftEvents = [{ type: "error", code: "limit", message: "That is all the cards from this connection today." }];
    renderBox();
    fireEvent.change(screen.getByTestId("idea-input"), { target: { value: "Something to try" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    await waitFor(() => expect(screen.getByTestId("idea-error").textContent).toMatch(/all the cards/));
    expect(screen.getByTestId("idea-generate")).toBeTruthy();
  });

  it("asks for a sentence before drafting a line that is too short", () => {
    renderBox();
    fireEvent.change(screen.getByTestId("idea-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    expect(screen.getByTestId("idea-error").textContent).toMatch(/sentence/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/idea-box/draft"))).toBe(false);
  });

  it("lands at once on the card this browser already holds", async () => {
    mine = { ...landedEvent, again: true };
    renderBox();
    await waitFor(() => expect(screen.getByTestId("idea-keep")).toBeTruthy());
    expect(screen.getByText(IDEA_BOX_WORDS.again)).toBeTruthy();
  });
});

describe("streamIdeaDraft", () => {
  it("reads lines split across chunks, and ends a cut stream with the not-open line", async () => {
    const seen: IdeaBoxEvent[] = [];
    await streamIdeaDraft("http://api", { prompt: "x y z", turnstile: "t" }, { onEvent: (e) => seen.push(e), fetchImpl: (async () => ndjsonResponse([{ type: "started" }, landedEvent], 7)) as unknown as typeof fetch });
    expect(seen.map((e) => e.type)).toEqual(["started", "card"]);
    const cut: IdeaBoxEvent[] = [];
    await streamIdeaDraft("http://api", { prompt: "x y z", turnstile: "t" }, { onEvent: (e) => cut.push(e), fetchImpl: (async () => ndjsonResponse([{ type: "started" }])) as unknown as typeof fetch });
    expect(cut.map((e) => e.type)).toEqual(["started", "error"]);
  });
});
