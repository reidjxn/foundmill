import { describe, expect, it } from "vitest";
import { z } from "zod";
import { batchEnded, collectBatch, submitBatch } from "./batch";
import { LiveModelClient } from "./client";
import { gateModelClient } from "./gate";
import { MockModelClient } from "./mock";
import { MODEL_PRICING } from "./pricing";
import { MODELS } from "./routing";
import type { BatchItem, UsageEvent } from "./types";

const noSleep = async () => undefined;

/** A fake Batches API: records the create body, reports `ended`, and streams JSONL results in the order given. */
function fakeBatches(results: unknown[]) {
  const created: { requests: { custom_id: string; params: Record<string, unknown> }[] }[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "request-id": "req_b" } });
    if (url.endsWith("/v1/messages/batches") && init?.method === "POST") {
      created.push(JSON.parse(String(init.body)));
      return json({ id: "msgbatch_1", type: "message_batch", processing_status: "in_progress" });
    }
    if (url.includes("/results")) return new Response(results.map((r) => JSON.stringify(r)).join("\n"), { status: 200, headers: { "content-type": "application/binary" } });
    if (url.includes("/v1/messages/batches/msgbatch_1")) return json({ id: "msgbatch_1", type: "message_batch", processing_status: "ended", results_url: "https://api.anthropic.com/v1/messages/batches/msgbatch_1/results" });
    throw new Error(`unexpected ${url}`);
  };
  return { fetch: fetchImpl as unknown as typeof globalThis.fetch, created };
}

const answer = (customId: string, text: string, opts: { stop?: string; model?: string } = {}) => ({
  custom_id: customId,
  result: { type: "succeeded", message: { id: `msg_${customId}`, type: "message", role: "assistant", model: opts.model ?? MODELS.haiku, content: [{ type: "text", text }], stop_reason: opts.stop ?? "end_turn", stop_sequence: null, usage: { input_tokens: 50_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } },
});

const Out = z.object({ label: z.string() });
const item = (customId: string, businessId = "b1"): BatchItem<{ label: string }> => ({ customId, request: { route: "classifier", schema: Out, messages: [{ role: "user", content: `item ${customId}` }], attribution: { businessId } } });

describe("the batch client (WP-09 T8)", () => {
  it("sends complete()'s body without stream, speed or fallbacks, and matches results by custom id in any order", async () => {
    const { fetch, created } = fakeBatches([answer("b", '{"label":"B"}'), answer("a", '{"label":"A"}')]);
    const events: UsageEvent[] = [];
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep, fastMode: true, onUsage: (e) => void events.push(e) });
    const items = [item("a"), item("b")];
    expect(await submitBatch(client, items)).toEqual({ batchId: "msgbatch_1", count: 2 });
    for (const r of created[0]!.requests) {
      expect(r.params.stream).toBeUndefined();
      expect(r.params.speed).toBeUndefined();
      expect(r.params.fallbacks).toBeUndefined();
    }
    expect(created[0]!.requests.map((r) => r.custom_id)).toEqual(["a", "b"]);
    expect(await batchEnded(client, "msgbatch_1")).toBe(true);
    const results = await collectBatch(client, "msgbatch_1", items);
    expect(results.map((r) => (r.ok ? r.result.json : null))).toEqual([{ label: "A" }, { label: "B" }]);
    // Half price, once per item, with the batch key a sink books idempotently.
    // 50,000 prompt tokens: under Haiku's long-prompt line, so the base card.
    const full = (MODEL_PRICING[MODELS.haiku].inputPerMTok * 100) / 20;
    expect(events.map((e) => e.cost.costMinor)).toEqual([full / 2, full / 2]);
    expect(events.map((e) => e.batch)).toEqual([{ id: "msgbatch_1", customId: "b" }, { id: "msgbatch_1", customId: "a" }]);
    // Collecting again books nothing more.
    await collectBatch(client, "msgbatch_1", items);
    expect(events).toHaveLength(2);
  });

  it("a refused, cut-off or invalid answer is ok: false, with no repair call; a failed request says what happened", async () => {
    const { fetch } = fakeBatches([answer("a", "", { stop: "refusal" }), answer("b", '{"lab', { stop: "max_tokens" }), answer("c", "not json"), { custom_id: "d", result: { type: "errored", error: { type: "error", error: { type: "invalid_request_error", message: "bad" } } } }, { custom_id: "e", result: { type: "expired" } }]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    const items = ["a", "b", "c", "d", "e", "f"].map((id) => item(id));
    await submitBatch(client, items);
    const results = await collectBatch(client, "msgbatch_1", items);
    expect(results.map((r) => (r.ok ? "ok" : r.kind))).toEqual(["refusal", "invalid_output", "invalid_output", "errored", "expired", "expired"]);
  });

  it("refuses bad custom ids, duplicates and items of two businesses before anything is sent", async () => {
    const { fetch, created } = fakeBatches([]);
    const client = new LiveModelClient({ apiKey: "k", fetch, sleep: noSleep });
    expect(() => submitBatch(client, [item("has space")])).toThrow(/custom id/);
    expect(() => submitBatch(client, [item("a"), item("a")])).toThrow(/twice/);
    expect(() => submitBatch(client, [item("a", "b1"), item("b", "b2")])).toThrow(/same business/);
    expect(() => submitBatch(client, [])).toThrow(/at least one/);
    expect(created).toEqual([]);
  });

  it("a gated client asks its gate once per item at submit", async () => {
    const asked: string[] = [];
    const client = gateModelClient(new MockModelClient(), async (call) => void asked.push(call.route));
    const items = [item("a"), item("b"), item("c")];
    const { batchId } = await submitBatch(client, items);
    expect(asked).toEqual(["classifier", "classifier", "classifier"]);
    await collectBatch(client, batchId, items);
    expect(asked).toHaveLength(3);
  });

  it("the mock answers at submit and ends at once, so the whole path runs in mock mode", async () => {
    const client = new MockModelClient();
    const items = [item("a"), item("b")];
    const { batchId } = await submitBatch(client, items);
    expect(await batchEnded(client, batchId)).toBe(true);
    const results = await collectBatch(client, batchId, items);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
