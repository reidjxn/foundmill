import { describe, expect, it } from "vitest";
import { ModelNotFundedError } from "./errors";
import { enforceModelFunding, type ModelFunding } from "./free-plan";
import { MockModelClient } from "./mock";
import { MODELS } from "./routing";
import type { UsageEvent } from "./types";

const fundingBy = (map: Record<string, ModelFunding>) => async (a?: { businessId?: string }) => map[a?.businessId ?? "none"] ?? "free_plan";
const ask = (businessId?: string, route: "planCompiler" | "conversation" = "conversation") => ({ route, attribution: businessId ? { businessId, kind: "x" } : undefined, messages: [{ role: "user" as const, content: "x" }] });

describe("who pays decides the model (WP-13)", () => {
  const funding = fundingBy({ free: "free_plan", pro: "paid_plan", own: "own_key" });

  it("runs a free account's calls on Haiku 5.5, locked routes included, a signed-out visitor's too, and a paid plan's as routed", async () => {
    const events: UsageEvent[] = [];
    const client = enforceModelFunding(new MockModelClient({ onUsage: (e) => void events.push(e) }), funding);
    await client.complete(ask("free", "planCompiler"));
    await client.complete(ask(undefined, "conversation"));
    await client.complete(ask("pro", "planCompiler"));
    expect(events.map((e) => [e.route, e.model])).toEqual([["planCompiler", MODELS.haiku], ["conversation", MODELS.haiku], ["planCompiler", MODELS.opus]]);
    expect(MODELS.haiku).toBe("claude-haiku-5-5");
  });

  it("refuses, before anything is spent, a business on its own key and a free web search", async () => {
    const events: UsageEvent[] = [];
    const client = enforceModelFunding(new MockModelClient({ onUsage: (e) => void events.push(e) }), funding);
    await expect(client.complete(ask("own"))).rejects.toMatchObject({ code: "not_funded", reason: "own_key_route" });
    await expect(client.searchWeb?.({ query: "bread", limit: 3, attribution: { businessId: "free", kind: "x" } })).rejects.toBeInstanceOf(ModelNotFundedError);
    expect(events).toHaveLength(0);
  });
});
