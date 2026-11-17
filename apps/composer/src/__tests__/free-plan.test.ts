/** The composer's client chooses by who pays (WP-13): a free business runs on Haiku 5.5, a paid plan as routed. */
import { repos } from "@foundmill/db";
import { MockModelClient, MODELS, type UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { composerModelClient } from "../usage";
import { createComposerHarness, type ComposerHarness } from "./harness";

let hz: ComposerHarness;
beforeAll(async () => {
  hz = await createComposerHarness("freeplan");
});
afterAll(async () => {
  await hz?.close();
});

describe("composerModelClient (WP-13)", () => {
  it("writes a free business's Inbox note on Haiku 5.5 and a paid plan's on its locked model", async () => {
    const events: UsageEvent[] = [];
    const client = composerModelClient(new MockModelClient({ onUsage: (e) => void events.push(e) }), hz.db);
    await repos.businesses.update(hz.db, hz.A.businessId, { planTier: "free", modelBilling: "credits" });
    await repos.businesses.update(hz.db, hz.B.businessId, { planTier: "pro", modelBilling: "credits" });
    for (const businessId of [hz.A.businessId, hz.B.businessId]) await client.complete({ route: "inboxComposer", attribution: { businessId, kind: "test" }, messages: [{ role: "user", content: "today" }] });
    expect(events.map((e) => e.model)).toEqual([MODELS.haiku, MODELS.opus]);
  });
});
