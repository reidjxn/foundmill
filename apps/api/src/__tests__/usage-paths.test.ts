/**
 * Every model call the API makes for a business is booked once to that business's usage ledger, and only there; a call
 * made before a business exists books nothing (review item 7). Each path runs through the production client
 * (`createApiModelClient`), counting the calls it reports, and the ledger rows that appeared are compared with them:
 * one row per call, the same routes, nothing in the other business, nothing for an account-level call.
 */
import { repos } from "@foundmill/db";
import type { UsageEvent } from "@foundmill/models";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createComposerClient } from "../services/composer";
import { silentLog } from "../services/log";
import { createApiModelClient } from "../services/models";
import { createApiHarness, type ApiHarness } from "./harness";

let hz: ApiHarness;
let events: UsageEvent[] = [];

beforeAll(async () => {
  hz = await createApiHarness({ prefix: "usage-paths" });
  const log = silentLog();
  // The production client, reporting each call it books; the in-process composer uses the same one.
  hz.deps.models = createApiModelClient(hz.deps.env, log, { db: hz.db, onUsage: (e) => void events.push(e) });
  hz.deps.composer = createComposerClient({
    url: "http://127.0.0.1:1",
    db: hz.db,
    models: hz.deps.models,
    log,
    allowFallback: true,
    fetch: async () => {
      throw new Error("composer service not running in tests");
    },
  });
}, 120_000);
afterAll(() => hz.close());

const tokenRows = async (businessId: string) => (await repos.usage.list(hz.db, businessId, { kind: "tokens", limit: 500 })).items;

/** Runs `act`, then checks the ledger against the calls the client reported while it ran. */
async function booked(act: () => Promise<unknown>): Promise<{ business: UsageEvent[]; account: UsageEvent[] }> {
  const [beforeA, beforeB] = await Promise.all([tokenRows(hz.A.businessId), tokenRows(hz.B.businessId)]);
  events = [];
  await act();
  const business = events.filter((e) => e.attribution?.businessId);
  const account = events.filter((e) => !e.attribution?.businessId);
  // Every call made for a business names business A here: never the other one.
  expect(business.every((e) => e.attribution?.businessId === hz.A.businessId)).toBe(true);
  const added = (await tokenRows(hz.A.businessId)).filter((u) => !beforeA.some((b) => b.id === u.id));
  expect(added).toHaveLength(business.length);
  expect(added.map((u) => (u.details as { route: string }).route).sort()).toEqual(business.map((e) => e.route).sort());
  expect(added.every((u) => u.currency === "USD" && (u.details as { label?: string; service?: string }).label === "Estimate" && (u.details as { service?: string }).service === "api")).toBe(true);
  expect(await tokenRows(hz.B.businessId)).toHaveLength(beforeB.length);
  return { business, account };
}

const owner = () => hz.caller({ userId: hz.A.ownerId });

async function decisionItem(subject: string) {
  return repos.inbox.createItem(hz.db, hz.A.businessId, {
    type: "decision",
    from_agent_id: hz.A.agentId,
    subject,
    body_md: "The team needs a steer on the first channel. Outbound is the recommended route for a narrow ICP.",
    status_strip: [],
    exhibit: { kind: "none", spec_ref: null },
    decision: {
      options: [
        { id: "outbound", label: "Outbound to a narrow ICP", recommended: true, consequence: "Lead generation starts first.", cost_minor: 0, reversible: true },
        { id: "content", label: "Content first", recommended: false, consequence: "SEO and content start first.", cost_minor: 0, reversible: true },
      ],
      free_text: true,
      expires_at: null,
    },
    blocks_continue: true,
    source_event_ids: [],
    entity_ids: [],
  });
}

describe("API model calls and the usage ledger, path by path", () => {
  it("plan.preview: the plan compiler call is booked once", async () => {
    const { business } = await booked(() => owner().plan.preview({ businessId: hz.A.businessId, text: "Enable outbound and set a €200 budget for it" }));
    expect(business.map((e) => e.route)).toEqual(["planCompiler"]);
  });

  it("inbox.decide with free text: the plan compiler call is booked once", async () => {
    const item = await decisionItem("Which channel first?");
    const { business } = await booked(() => owner().inbox.decide({ businessId: hz.A.businessId, itemId: item.id, freeText: "spend €100 on Google ads this week" }));
    expect(business.map((e) => e.route)).toEqual(["planCompiler"]);
  });

  it("agent.conversation.send: the reply is booked once, with its agent", async () => {
    const { business } = await booked(() => owner().agent.conversation.send({ businessId: hz.A.businessId, subject: { kind: "agent", id: hz.A.agentId }, text: "Is the supplier invoice due?" }));
    expect(business.map((e) => [e.route, e.attribution?.agentId])).toEqual([["conversation", hz.A.agentId]]);
  });

  it("inbox.refresh (the in-process composer): booked once", async () => {
    const { business } = await booked(() => owner().inbox.refresh({ businessId: hz.A.businessId }));
    expect(business.map((e) => e.route)).toEqual(["inboxComposer"]);
  });

  it("the recommenders and the planner: each call booked once", async () => {
    const legal = await booked(() => owner().legal.recommend({ businessId: hz.A.businessId }));
    const distribution = await booked(() => owner().distribution.recommend({ businessId: hz.A.businessId }));
    const planner = await booked(() => owner().dev.tasks.plan({ businessId: hz.A.businessId, goal: "Ship the pricing page" }));
    expect([...legal.business, ...distribution.business, ...planner.business].map((e) => e.route)).toEqual(["departmentLead", "departmentLead", "planner"]);
  });

  it("Ideation drafting and Ask on a concept, before a business exists: no business, nothing booked", async () => {
    let ideaId = "";
    const drafted = await booked(async () => {
      ideaId = (await owner().idea.generate({ prompt: "bookkeeping for independent accountants in the Nordics" })).ideas[0]!.id;
    });
    expect(drafted.business).toHaveLength(0);
    expect(drafted.account.length).toBeGreaterThan(0);
    const asked = await booked(() => owner().idea.ask({ ideaId, quickReplyId: "who_pays_first" }));
    expect(asked.business).toHaveLength(0);
    expect(asked.account.map((e) => e.attribution?.kind)).toEqual(["ideation_ask"]);
  });
});
