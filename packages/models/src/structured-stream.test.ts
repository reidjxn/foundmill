/**
 * `runStructuredStream` with scripted streams: element delivery, element validation and repair, full repair with
 * pinned elements, restart/resume after interruptions, and the `streamStructured(client, req)` fallback.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelOutputError, ModelUnavailableError } from "./errors";
import { ZERO_USAGE, meter } from "./pricing";
import { MODELS } from "./routing";
import { type StreamCallArgs, type StreamCallResult, StreamInterruptedError, type StructuredStreamDeps, runStructuredStream, streamStructured } from "./structured-stream";
import type { ChatMessage, CompleteRequest, CompleteResultWithJson, ModelClient, StreamProgress, StreamStructuredRequest, StreamedElement, TokenUsage } from "./types";

const Item = z.object({ name: z.string().min(1), score: z.number().int().min(1).max(5) });
type Item = z.infer<typeof Item>;
const Doc = z.object({ title: z.string(), items: z.array(Item).min(3).max(6) });
type Doc = z.infer<typeof Doc>;

const usage = (out = 10): TokenUsage => ({ ...ZERO_USAGE, inputTokens: 20, outputTokens: out });

type Script = { text: string; chunk?: number; stopReason?: StreamCallResult["stopReason"]; breakAfter?: number } | Error;

/** Deps whose streams play `scripts` in order (one per call) and whose `complete` answers element repairs. */
function scripted(scripts: Script[], repairs: unknown[] = []) {
  const streamCalls: { messages: readonly ChatMessage[]; call: number }[] = [];
  const completeCalls: CompleteRequest[] = [];
  const deps: StructuredStreamDeps = {
    mode: "mock",
    modelId: MODELS.opus,
    modelKey: "opus",
    maxTokens: 8000,
    streamCall: async (args: StreamCallArgs) => {
      streamCalls.push({ messages: args.messages, call: args.call });
      const script = scripts[Math.min(streamCalls.length - 1, scripts.length - 1)] as Script;
      if (script instanceof Error) throw script;
      const size = script.chunk ?? 7;
      const end = script.breakAfter ?? script.text.length;
      let sent = "";
      for (let at = 0; at < end; at += size) {
        const piece = script.text.slice(at, Math.min(end, at + size));
        sent += piece;
        await args.onText(piece);
      }
      if (script.breakAfter !== undefined) throw new StreamInterruptedError("overloaded_error mid-stream", sent, usage(3), meter(usage(3), MODELS.opus), new Error("Overloaded"));
      return { text: script.text, stopReason: script.stopReason ?? "end_turn", usage: usage(), cost: meter(usage(), MODELS.opus), requestId: `req_${args.call}` };
    },
    complete: async <X,>(req: CompleteRequest<X> & { schema: z.ZodType<X> }): Promise<CompleteResultWithJson<X>> => {
      completeCalls.push(req as CompleteRequest);
      const value = repairs[completeCalls.length - 1];
      const json = req.schema.parse(value);
      return { text: JSON.stringify(value), json, usage: usage(5), model: MODELS.opus, modelKey: "opus", route: req.route, stopReason: "end_turn", cost: meter(usage(5), MODELS.opus), mode: "mock", durationMs: 1, repaired: false };
    },
  };
  return { deps, streamCalls, completeCalls };
}

function request(extra: Partial<StreamStructuredRequest<Doc, Item>> = {}) {
  const delivered: StreamedElement<Item>[] = [];
  const progress: StreamProgress[] = [];
  const req: StreamStructuredRequest<Doc, Item> = {
    route: "ideation",
    system: "Draft items.",
    messages: [{ role: "user", content: "go" }],
    schema: Doc,
    elementPath: "items",
    elementSchema: Item,
    onElement: (e) => void delivered.push(e),
    onPartial: (p) => void progress.push({ ...p, snapshot: p.snapshot }),
    partialThrottleMs: 0,
    ...extra,
  };
  return { req, delivered, progress };
}

const items = (n: number, prefix = "Item") => Array.from({ length: n }, (_, i) => ({ name: `${prefix} ${i}`, score: (i % 5) + 1 }));
const doc = (list: unknown[], title = "Slate") => JSON.stringify({ title, items: list }, null, 2);

describe("runStructuredStream", () => {
  it("delivers every element in order as it arrives and returns the validated document", async () => {
    const { deps, streamCalls, completeCalls } = scripted([{ text: doc(items(4)), chunk: 5 }]);
    const order: string[] = [];
    const { req, delivered, progress } = request({ onElement: (e) => void order.push(`el:${e.index}`) });
    const seenChars: number[] = [];
    req.onPartial = (p) => {
      progress.push(p);
      seenChars.push(p.chars);
    };
    const r = await runStructuredStream(req, deps);
    expect(order).toEqual(["el:0", "el:1", "el:2", "el:3"]);
    expect(delivered).toEqual([]);
    expect(r.json).toEqual({ title: "Slate", items: items(4) });
    expect(r.elements).toEqual(items(4));
    expect(r.repaired).toBe(false);
    expect(r.repairedElements).toEqual([]);
    expect(r.calls).toBe(1);
    expect(streamCalls).toHaveLength(1);
    expect(completeCalls).toHaveLength(0);
    expect(r.firstTextMs).toBeGreaterThanOrEqual(0);
    expect(r.firstElementMs).toBeGreaterThanOrEqual(r.firstTextMs ?? 0);
    expect(progress[0]?.phase).toBe("waiting");
    expect(progress.some((p) => p.phase === "streaming")).toBe(true);
    expect(progress.at(-1)?.phase).toBe("done");
    expect(progress.at(-1)?.elementsEmitted).toBe(4);
    expect(Math.max(...seenChars)).toBeGreaterThan(0);
  });

  it("validates each element: a failing one is held back, repaired alone after the stream, and delivered last", async () => {
    const list = items(4);
    (list[1] as { score: number }).score = 9; // fails Item (max 5) and the full schema
    const { deps, completeCalls, streamCalls } = scripted([{ text: doc(list) }], [{ name: "Item 1 (fixed)", score: 4 }]);
    const { req, delivered } = request();
    const r = await runStructuredStream(req, deps);
    expect(delivered.map((e) => [e.index, e.repaired])).toEqual([
      [0, false],
      [2, false],
      [3, false],
      [1, true],
    ]);
    expect(streamCalls).toHaveLength(1);
    expect(completeCalls).toHaveLength(1);
    expect(completeCalls[0]?.schema).toBe(Item);
    expect(completeCalls[0]?.messages.at(-1)?.content).toMatch(/Element 1 of "items"/);
    expect(completeCalls[0]?.messages.at(-1)?.content).toMatch(/score/);
    expect(r.json.items[1]).toEqual({ name: "Item 1 (fixed)", score: 4 });
    expect(r.elements[1]).toEqual({ name: "Item 1 (fixed)", score: 4 });
    expect(r.repairedElements).toEqual([1]);
    expect(r.repaired).toBe(true);
    expect(r.calls).toBe(2);
  });

  it("repairs an element that only the element schema rejects, so every final element passed it", async () => {
    const Strict = Item.refine((i) => !i.name.includes("draft"), "names must not say draft");
    const list = items(3);
    (list[2] as { name: string }).name = "draft name";
    const { deps, completeCalls } = scripted([{ text: doc(list) }], [{ name: "Final name", score: 3 }]);
    const { req, delivered } = request({ elementSchema: Strict });
    const r = await runStructuredStream(req, deps);
    expect(completeCalls).toHaveLength(1);
    expect(delivered.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(r.json.items[2]?.name).toBe("Final name");
  });

  it("runs one full repair when the document itself is wrong, keeping delivered elements pinned", async () => {
    // First stream: only two items (schema needs 3). Repair stream rewrites item 0 differently and adds two more.
    const first = doc(items(2));
    const repairedDoc = doc([{ name: "Rewritten 0", score: 5 }, ...items(3).slice(1)], "Slate v2");
    const { deps, streamCalls } = scripted([{ text: first }, { text: repairedDoc }]);
    const { req, delivered, progress } = request();
    const r = await runStructuredStream(req, deps);
    expect(streamCalls).toHaveLength(2);
    const repairPrompt = streamCalls[1]?.messages.at(-1)?.content ?? "";
    expect(repairPrompt).toMatch(/items: Too small|items/);
    expect(repairPrompt).toMatch(/positions 0, 1/);
    expect(streamCalls[1]?.messages.at(-2)).toEqual({ role: "assistant", content: first });
    // Items 0 and 1 came from the first stream and stay; item 2 is new.
    expect(delivered.map((e) => [e.index, e.repaired])).toEqual([
      [0, false],
      [1, false],
      [2, true],
    ]);
    expect(r.json).toEqual({ title: "Slate v2", items: items(3) });
    expect(r.repaired).toBe(true);
    expect(progress.some((p) => p.phase === "repairing")).toBe(true);
  });

  it("throws after the one full repair still fails", async () => {
    const { deps } = scripted([{ text: doc(items(1)) }, { text: doc(items(2)) }]);
    const { req } = request();
    await expect(runStructuredStream(req, deps)).rejects.toMatchObject({ name: "ModelOutputError", code: "invalid_output" });
  });

  it("restarts a stream that broke before anything was delivered, with the same messages", async () => {
    const text = doc(items(3));
    const { deps, streamCalls } = scripted([{ text, breakAfter: 10 }, { text }]);
    const { req, delivered, progress } = request();
    const r = await runStructuredStream(req, deps);
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1]?.messages).toEqual(req.messages);
    expect(delivered.map((e) => [e.index, e.repaired])).toEqual([
      [0, false],
      [1, false],
      [2, false],
    ]);
    expect(r.json.items).toEqual(items(3));
    expect(progress.some((p) => p.phase === "retrying")).toBe(true);
    expect(r.usage.outputTokens).toBe(13); // interrupted call (3) + the restart (10)
  });

  it("resumes a stream that broke after delivering elements: no element is delivered twice and delivered ones stay", async () => {
    const text = doc(items(4));
    const cut = text.indexOf("Item 2"); // items 0 and 1 are complete
    const resumed = doc([{ name: "Other 0", score: 1 }, { name: "Other 1", score: 1 }, ...items(4).slice(2)]);
    const { deps, streamCalls } = scripted([{ text, breakAfter: cut }, { text: resumed }]);
    const { req, delivered } = request();
    const r = await runStructuredStream(req, deps);
    expect(streamCalls).toHaveLength(2);
    expect(streamCalls[1]?.messages.at(-2)).toEqual({ role: "assistant", content: text.slice(0, cut) });
    expect(streamCalls[1]?.messages.at(-1)?.content).toMatch(/cut off/);
    expect(streamCalls[1]?.messages.at(-1)?.content).toMatch(/positions 0, 1/);
    expect(delivered.map((e) => [e.index, e.repaired])).toEqual([
      [0, false],
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(r.json.items).toEqual(items(4));
  });

  it("gives up after too many interruptions with a typed error", async () => {
    const text = doc(items(3));
    const { deps } = scripted([{ text, breakAfter: 5 }]);
    const { req } = request();
    await expect(runStructuredStream(req, { ...deps, maxInterruptions: 1 })).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it("propagates a throwing onElement without retrying", async () => {
    const { deps, streamCalls } = scripted([{ text: doc(items(3)) }]);
    const { req } = request({
      onElement: (e) => {
        if (e.index === 1) throw new Error("db write failed");
      },
    });
    await expect(runStructuredStream(req, deps)).rejects.toThrow("db write failed");
    expect(streamCalls).toHaveLength(1);
  });

  it("reports truncation with what was delivered", async () => {
    const text = doc(items(4));
    const { deps } = scripted([{ text: text.slice(0, text.indexOf("Item 2")), stopReason: "max_tokens" }]);
    const { req, delivered } = request();
    const error = await runStructuredStream(req, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelOutputError);
    expect((error as ModelOutputError).code).toBe("max_tokens");
    expect((error as ModelOutputError).details).toMatchObject({ delivered: 2, elements: [{ index: 0 }, { index: 1 }] });
    expect(delivered).toHaveLength(2);
  });

  it("surfaces a refusal as a typed error", async () => {
    const { deps } = scripted([{ text: "", stopReason: "refusal" }]);
    await expect(runStructuredStream(request().req, deps)).rejects.toMatchObject({ code: "refusal" });
  });

  it("throttles onPartial while text streams but always reports elements and phase changes", async () => {
    let t = 0;
    const { deps } = scripted([{ text: doc(items(3)), chunk: 1 }]);
    const { req, progress } = request({ partialThrottleMs: 1_000_000 });
    const snapshots: unknown[] = [];
    req.onPartial = (p) => {
      progress.push(p);
      snapshots.push(p.snapshot());
    };
    const r = await runStructuredStream(req, { ...deps, now: () => t++ });
    // waiting, the first JSON character, one per element, done (no throttled text reports get through at this interval)
    expect(progress.map((p) => p.phase)).toEqual(["waiting", "streaming", "streaming", "streaming", "streaming", "done"]);
    expect(progress.map((p) => p.elementsEmitted)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(r.elements).toHaveLength(3);
    expect((snapshots[3] as Doc).items).toEqual(items(2));
    expect(snapshots.at(-1)).toEqual({ title: "Slate", items: items(3) });
  });
});

describe("streamStructured(client, req)", () => {
  it("falls back to complete() and delivers the elements in order for a client without streaming", async () => {
    const json = { title: "Slate", items: items(3) };
    const client: ModelClient = {
      mode: "mock",
      complete: (async (req: CompleteRequest) => ({ text: JSON.stringify(json), json: req.schema?.parse(json), usage: usage(), model: MODELS.opus, modelKey: "opus", route: req.route, stopReason: "end_turn", cost: meter(usage(), MODELS.opus), mode: "mock", durationMs: 1, repaired: false })) as ModelClient["complete"],
    };
    const { req, delivered, progress } = request();
    const r = await streamStructured(client, req);
    expect(delivered.map((e) => e.index)).toEqual([0, 1, 2]);
    expect(r.elements).toEqual(items(3));
    expect(r.calls).toBe(1);
    expect(progress.at(-1)?.phase).toBe("done");
  });
});
