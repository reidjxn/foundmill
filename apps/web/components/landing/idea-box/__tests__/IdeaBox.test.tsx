/**
 * The idea box on the landing page (docs/IDEA_BOX.md): the typing placeholder until the field is focused, Surprise me's
 * interests, a draft streamed into the card, the ways to keep it (the sign-in link carries the claim token), a
 * refusal's one line, and a browser that already holds a card landing on it.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_NAME } from "@foundmill/config";
import { TooltipProvider } from "@foundmill/dugout";
import { IDEA_BOX_DEADLINE_MS, IDEA_BOX_ERRORS, IDEA_BOX_INTERESTS, type IdeaBoxEvent } from "@foundmill/shared";
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
    draftEvents = [{ type: "error", code: "limit", message: "That is all the ideas from this connection today." }];
    renderBox();
    fireEvent.change(screen.getByTestId("idea-input"), { target: { value: "Something to try" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    await waitFor(() => expect(screen.getByTestId("idea-error").textContent).toMatch(/all the ideas/));
    expect(screen.getByTestId("idea-generate")).toBeTruthy();
  });

  it("asks for a sentence before drafting a line that is too short", () => {
    renderBox();
    fireEvent.change(screen.getByTestId("idea-input"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    expect(screen.getByTestId("idea-error").textContent).toMatch(/sentence/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/idea-box/draft"))).toBe(false);
  });

  it("stops a stream that stalls, shows the failed line and gives the visitor's words back in the field (WP-03 T7)", async () => {
    vi.useFakeTimers();
    const enc = new TextEncoder();
    let stalled: ReadableStreamDefaultController<Uint8Array> | undefined;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/idea-box/mine")) return new Response(null, { status: 204 });
      // A stream that says it started and then never ends; it errors only when the page aborts it.
      const body = new ReadableStream<Uint8Array>({ start(c) { stalled = c; c.enqueue(enc.encode(`${JSON.stringify({ type: "started" })}\n`)); } });
      init?.signal?.addEventListener("abort", () => stalled?.error(new DOMException("aborted", "AbortError")));
      return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson" } });
    });
    renderBox();
    fireEvent.change(screen.getByTestId("idea-input"), { target: { value: "Restored film cameras" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDEA_BOX_DEADLINE_MS);
    });
    // Still waiting at the server's deadline: the page gives the stream 5 more seconds on the way.
    expect(screen.queryByTestId("idea-error")).toBeNull();
    expect(screen.getByTestId("idea-generate").hasAttribute("disabled")).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByTestId("idea-error").textContent).toBe(IDEA_BOX_ERRORS.failed);
    const input = screen.getByTestId("idea-input") as HTMLTextAreaElement;
    expect(input.value).toBe("Restored film cameras");
    expect(input.disabled).toBe(false);
    expect(screen.queryByTestId("idea-result")).toBeNull();
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/idea-box/draft"))!;
    expect((init as RequestInit).signal?.aborted).toBe(true);
  });

  it("says what keeping the idea does today, and what it costs", async () => {
    mine = { ...landedEvent, again: true };
    renderBox();
    await waitFor(() => expect(screen.getByTestId("idea-keep")).toBeTruthy());
    expect(IDEA_BOX_WORDS.keepLead).toBe(`Sign in to keep this idea. ${APP_NAME} lets new people in a few at a time. If your place is not open yet, we hold your idea for 90 days.`);
    expect(IDEA_BOX_WORDS.freeLine).toMatch(/^Free to start\. Your plan includes \$\d+\.\d{2} of agent work every month\. You never enter payment details\.$/);
    expect(screen.getByText(IDEA_BOX_WORDS.keepLead)).toBeTruthy();
    expect(screen.getByText(IDEA_BOX_WORDS.freeLine)).toBeTruthy();
    // The team cannot check numbers against real sources yet (a1 FR-06): nothing on the box says it does.
    expect(screen.getByTestId("idea-keep").textContent).not.toMatch(/real sources|checks it/i);
  });

  it("Try another idea gives the field back with the card's words, and the next draft asks to replace the card (WP-03 T7)", async () => {
    const onLanded = vi.fn();
    mine = { ...landedEvent, again: true };
    renderBox({ onLanded });
    await waitFor(() => expect(screen.getByTestId("idea-keep")).toBeTruthy());
    const button = screen.getByRole("button", { name: IDEA_BOX_WORDS.tryAnother });
    expect(button.className).toContain("btn-ghost");
    fireEvent.click(button);
    const input = screen.getByTestId("idea-input") as HTMLTextAreaElement;
    expect(input.value).toBe("Restored film cameras");
    expect(onLanded).toHaveBeenLastCalledWith(null);
    draftEvents = [{ type: "started" }, { ...landedEvent, prompt: "Restored film cameras for first-time buyers" }];
    fireEvent.change(input, { target: { value: "Restored film cameras for first-time buyers" } });
    fireEvent.click(screen.getByTestId("idea-generate"));
    await waitFor(() => expect(screen.getByTestId("idea-keep")).toBeTruthy());
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/idea-box/draft"))!;
    expect(JSON.parse(init.body)).toEqual({ prompt: "Restored film cameras for first-time buyers", interest: null, turnstile: "mock-ok", website: "", again: true });
    expect(screen.getByTestId("idea-landed-words").textContent).toBe("Restored film cameras for first-time buyers");
  });

  it("a refused redraw goes back to the card the browser still holds, with the refusal's line", async () => {
    mine = { ...landedEvent, again: true };
    renderBox();
    await waitFor(() => expect(screen.getByTestId("idea-keep")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: IDEA_BOX_WORDS.tryAnother }));
    draftEvents = [{ type: "error", code: "limit", message: IDEA_BOX_ERRORS.limit }];
    fireEvent.click(screen.getByTestId("idea-generate"));
    await waitFor(() => expect(screen.getByTestId("idea-error").textContent).toBe(IDEA_BOX_ERRORS.limit));
    expect(screen.getByTestId("idea-keep")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Firstframe" })).toBeTruthy();
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
