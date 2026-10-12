/**
 * A channel switched by a plan that runs in-process (an Inbox decision, a confirmed plan) gets its engine, as the
 * Board toggle does (AC-11.7.2, audit VGJC-X1): enabling starts `channelEngine` and records its workflow id on the
 * channel; disabling signals the engine to stop.
 */
import { repos } from "@foundmill/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiHarness, fakeTemporalClient, type ApiHarness } from "./harness";

let hz: ApiHarness;
const temporal = fakeTemporalClient();
beforeAll(async () => {
  hz = await createApiHarness({ prefix: "plan-engine", temporalClient: temporal });
}, 120_000);
afterAll(() => hz.close());

describe("plan actions that switch a channel", () => {
  it("a confirmed enable_channel starts the channel's engine; disable_channel stops it", async () => {
    const owner = hz.caller({ userId: hz.A.ownerId });
    const { businessId } = hz.A;
    const enable = await repos.plans.create(hz.db, businessId, { origin: "free_text", summaryMd: "Start affiliate marketing", status: "pending_confirmation", actions: [{ type: "enable_channel", params: { channel: "affiliate" }, policyOutcome: "ask" }] });
    const confirmed = await owner.plan.confirm({ businessId, planId: enable.id });
    expect(confirmed.exec.executed).toEqual([enable.actions[0]!.id]);
    const channel = await repos.channels.getByKey(hz.db, businessId, "affiliate");
    expect(channel?.enabled).toBe(true);
    const workflowId = `engine:${channel!.id}`;
    expect(temporal.starts).toContainEqual({ type: "channelEngine", workflowId, args: [{ businessId, channelId: channel!.id, channelKey: "affiliate" }] });
    expect((await repos.channels.getByKey(hz.db, businessId, "affiliate"))?.engineWorkflowId).toBe(workflowId);

    const disable = await repos.plans.create(hz.db, businessId, { origin: "free_text", summaryMd: "Stop affiliate marketing", status: "pending_confirmation", actions: [{ type: "disable_channel", params: { channel: "affiliate" }, policyOutcome: "ask" }] });
    await owner.plan.confirm({ businessId, planId: disable.id });
    expect(temporal.signals).toContainEqual({ workflowId, signal: "stop", args: [{ reason: "channel_disabled", by: hz.A.ownerId }] });
    const stopped = await repos.channels.getByKey(hz.db, businessId, "affiliate");
    expect(stopped?.enabled).toBe(false);
    expect(stopped?.engineWorkflowId).toBeNull();
  });
});
