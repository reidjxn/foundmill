/**
 * What the commentary model is shown: the update level by its display name (brief / standard / featured) in both the
 * system prompt and the user-message JSON, never the internal enum (friendly / league / cup) that invites football
 * phrasing (CLAUDE.md 2026-10-08; DECISIONS 2026-10-08 "the model never sees friendly or cup").
 */
import { repos } from "@foundmill/db";
import type { ModelClient } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composeCommentary } from "../commentary";
import { createComposerHarness, silentLog, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("commentary");
}, 120_000);
afterAll(() => hz?.close());

describe("composeCommentary inputs", () => {
  it.each([
    ["cup", "featured", 0],
    ["league", "standard", 1],
    ["friendly", "brief", 2],
  ] as const)("a %s journey reaches the model as a %s update", async (level, display, n) => {
    const touches = await repos.journeys.recordTouches(hz.db, hz.A.businessId, [{ entityId: hz.A.entityId, channelKey: "seo", kind: "visit", occurredAt: new Date(Date.now() - 86_400_000) }]);
    const journey = await repos.journeys.create(hz.db, hz.A.businessId, { conversionId: hz.A.conversionIds[n]!, touchIds: touches.map((t) => t.id), weights: { [touches[0]!.id]: 1 }, matchdayLevel: level, agents: [] });
    const seen: { system: string; user: string }[] = [];
    const models = {
      complete: async (req: { system: unknown; messages: { content: string }[] }) => {
        seen.push({ system: JSON.stringify(req.system), user: req.messages[0]!.content });
        throw new Error("captured");
      },
    } as unknown as ModelClient;
    await expect(composeCommentary({ db: hz.db, models, log: silentLog }, hz.A.businessId, journey.id)).rejects.toThrow("captured");
    const { system, user } = seen[0]!;
    expect(user).toContain(`"update_level":"${display}"`);
    expect(system).toContain(`${display} update`);
    for (const text of [system, user]) {
      expect(text).not.toMatch(/"matchday_level"|\bmatchday\b/i);
      expect(text).not.toMatch(/"(?:friendly|league|cup)"/);
    }
  });
});
