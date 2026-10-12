/**
 * Offline structure tests for the channel creative eval (mock mode, every change): the cases are well formed, the
 * request carries the campaign as inert JSON with the channel's own system prompt, the deterministic checks pass over
 * the mock route and catch what they are meant to catch.
 */
import { buildChannelCreativeRequest, CHANNEL_ASSET_KINDS, finaliseCreative } from "@foundmill/agents";
import { MockModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { CHANNEL_CREATIVE_CASES } from "../channel-creative/cases";
import { checkChannelCreative, runChannelCreativeCase } from "../channel-creative/run";

describe("channel creative eval cases", () => {
  it("have unique ids, a rubric, and expect only kinds their channel produces", () => {
    expect(new Set(CHANNEL_CREATIVE_CASES.map((c) => c.id)).size).toBe(CHANNEL_CREATIVE_CASES.length);
    for (const c of CHANNEL_CREATIVE_CASES) {
      expect(c.id.startsWith("channel_creative."), c.id).toBe(true);
      expect(c.rubric.length, c.id).toBeGreaterThanOrEqual(2);
      for (const k of c.kinds) expect(CHANNEL_ASSET_KINDS[c.input.channelKey], c.id).toContain(k);
    }
  });

  it("the request runs on the worker route with the channel's house rules and the campaign as JSON", () => {
    const req = buildChannelCreativeRequest(CHANNEL_CREATIVE_CASES[0]!.input);
    expect(req.route).toBe("worker");
    expect(req.system[0]).toContain("## House rules");
    expect(req.messages[0]!.content).toContain('"creative_request"');
    expect(req.messages[0]!.content).toContain("{{{unsubscribe}}}");
  });

  it("the deterministic checks pass over the mock route for every case (no grader offline)", async () => {
    const client = new MockModelClient();
    for (const c of CHANNEL_CREATIVE_CASES) {
      const r = await runChannelCreativeCase(c, { client, grade: false });
      expect(r.error, c.id).toBeUndefined();
      expect(r.problems, c.id).toEqual([]);
    }
  });

  it("the checks catch a wrong kind, an empty draft and forbidden text; finalising drops kinds the channel does not make", () => {
    const c = CHANNEL_CREATIVE_CASES[0]!;
    const problems = checkChannelCreative(c, [{ kind: "ad", title: "x", body: "I am a human writing to you" }]);
    expect(problems.some((p) => p.includes("kind ad"))).toBe(true);
    expect(problems.some((p) => p.includes("I am a human"))).toBe(true);
    expect(checkChannelCreative(c, [])).toContain("no creative was drafted");
    expect(finaliseCreative({ assets: [{ kind: "ad", title: "Ad", body: "Buy" }, { kind: "email", title: "", body: "Hello" }], channel_note: "" }, { channelKey: "email_automation", label: "Mock draft" })).toEqual([{ kind: "email", title: "Email automation draft", body: "Mock draft\n\nHello" }]);
  });
});
