/**
 * The plan action params the compilers write and the executors read (audit VRB-X1, verify-api-services-x1): one schema
 * per action, the roadmap item an instruction names, and the field-level change it asks for.
 */
import { PLAN_ACTION_TYPES } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { compilePlanRuleBased } from "./mock/planCompiler";
import { matchRoadmapItem, PLAN_ACTION_PARAM_SCHEMAS, PLAN_ACTION_PARAMS, parsePlanActionParams, quarterBounds, resolveRoadmapItem, roadmapPatchFrom, SetAgentModelParams, UpdateRoadmapParams } from "./planParams";

const today = new Date("2026-10-12T15:00:00.000Z");
const items = [
  { id: "a", title: "Retail portal" },
  { id: "b", title: "Partner portal" },
  { id: "c", title: "Multi-currency matching" },
];

describe("plan action params", () => {
  it("documents every action type for the live compiler", () => {
    expect(Object.keys(PLAN_ACTION_PARAMS).sort()).toEqual([...PLAN_ACTION_TYPES].sort());
    expect(PLAN_ACTION_PARAMS.set_agent_model).toHaveProperty("apply_scope");
    expect(PLAN_ACTION_PARAMS.update_roadmap).toHaveProperty("roadmap_item_id");
  });

  it("set_agent_model reads apply_scope, and the older scope as the same thing", () => {
    expect(SetAgentModelParams.parse({ model_key: "haiku", agent_id: null, apply_scope: "all" })).toEqual({ model_key: "haiku", agent_id: null, apply_scope: "all" });
    expect(SetAgentModelParams.parse({ model_key: "haiku", agent_id: null, scope: "all" })).toEqual({ model_key: "haiku", agent_id: null, apply_scope: "all" });
    expect(SetAgentModelParams.parse({ model_key: "opus", agent_id: "x" }).apply_scope).toBe("agent");
    expect(SetAgentModelParams.safeParse({ model_key: null, apply_scope: "all" }).success).toBe(false);
  });

  it("the rule compiler writes the shared names", () => {
    expect(compilePlanRuleBased("Switch all agents to haiku").actions[0]).toMatchObject({ type: "set_agent_model", params: { model_key: "haiku", apply_scope: "all" } });
    expect(compilePlanRuleBased("Push the retail portal milestone to next quarter", { roadmap: items }).actions[0]).toMatchObject({ type: "update_roadmap", params: { roadmap_item_id: "a", change: expect.stringMatching(/retail portal/i) } });
  });
});

describe("roadmap changes", () => {
  it("names the item whose title shares the most words, and nothing on a tie or no overlap", () => {
    expect(matchRoadmapItem("push the retail portal milestone to next quarter", items)?.id).toBe("a");
    expect(matchRoadmapItem("move the portal to later", items)).toBeNull();
    expect(matchRoadmapItem("push the warehouse robots to later", items)).toBeNull();
    // An id that is not on the roadmap falls back to the words.
    expect(resolveRoadmapItem(UpdateRoadmapParams.parse({ roadmap_item_id: "zzz", change: "bring multi-currency matching forward" }), items)?.id).toBe("c");
  });

  it("reads a quarter as dates and a horizon", () => {
    expect(quarterBounds(today, 1)).toMatchObject({ start: "2027-01-01", end: "2027-03-31", offset: 1 });
    expect(roadmapPatchFrom(UpdateRoadmapParams.parse({ change: "Push the retail portal milestone to next quarter" }), { horizon: "now" }, today)).toEqual({ horizon: "next", targetStart: "2027-01-01", targetEnd: "2027-03-31" });
    expect(roadmapPatchFrom(UpdateRoadmapParams.parse({ change: "Move the partner portal to Q3" }), { horizon: "now" }, today)).toEqual({ horizon: "later", targetStart: "2027-07-01", targetEnd: "2027-09-30" });
    expect(roadmapPatchFrom(UpdateRoadmapParams.parse({ change: "Keep it in this quarter" }), { horizon: "next" }, today)).toEqual({ horizon: "now", targetStart: "2026-10-01", targetEnd: "2026-12-31" });
  });

  it("reads horizons and relative moves, typed fields first, and nothing from words it cannot read", () => {
    const patch = (change: string, horizon: "now" | "next" | "later" = "now") => roadmapPatchFrom(UpdateRoadmapParams.parse({ change }), { horizon }, today);
    expect(patch("Move the retail portal to later")).toEqual({ horizon: "later" });
    expect(patch("Put matching in the backlog")).toEqual({ horizon: "later" });
    expect(patch("Push the retail portal back")).toEqual({ horizon: "next" });
    expect(patch("Bring the partner portal forward", "later")).toEqual({ horizon: "next" });
    expect(patch("Update the roadmap milestone")).toEqual({});
    expect(roadmapPatchFrom(UpdateRoadmapParams.parse({ horizon: "later", target_start: "2027-04-01", change: "next quarter" }), { horizon: "now" }, today)).toEqual({ horizon: "later", targetStart: "2027-04-01" });
  });
});

describe("PLAN_ACTION_PARAM_SCHEMAS (what the api can carry out)", () => {
  it("has a schema for every action type", () => {
    expect(Object.keys(PLAN_ACTION_PARAM_SCHEMAS).sort()).toEqual([...PLAN_ACTION_TYPES].sort());
  });

  it("accepts the params the plan compiler writes and refuses ones that would do nothing", () => {
    expect(parsePlanActionParams("create_task", { kind: "code", title: "Build the waitlist page", goal: "A page that takes emails" })).toMatchObject({ kind: "code", title: "Build the waitlist page" });
    expect(parsePlanActionParams("create_task", { kind: "coding", title: "Build it" })).toBeNull();
    expect(parsePlanActionParams("create_task", { kind: "code", title: " " })).toBeNull();
    expect(parsePlanActionParams("enable_channel", { channel: "paid_ads" })).not.toBeNull();
    expect(parsePlanActionParams("enable_channel", { channel: "linkedin" })).toBeNull();
    expect(parsePlanActionParams("set_budget", { amount_minor: 20000, currency: "GBP", channel: "paid_ads", period: "monthly" })).not.toBeNull();
    expect(parsePlanActionParams("set_budget", { amount_minor: 20000, scope: "department", department: "Marketing" })).not.toBeNull();
    expect(parsePlanActionParams("set_budget", { amount_minor: 20000 })).toBeNull();
    expect(parsePlanActionParams("set_budget", { amount_minor: -5, channel: "paid_ads" })).toBeNull();
    expect(parsePlanActionParams("set_budget", { amount_minor: 12.5, channel: "paid_ads" })).toBeNull();
    expect(parsePlanActionParams("request_human_action", { request: "Pay the designer invoice", instructions: "From your own account" })).not.toBeNull();
    expect(parsePlanActionParams("request_human_action", { instructions: "x" })).toBeNull();
    expect(parsePlanActionParams("set_agent_model", { model_key: "sonnet", agent_id: "a1" })).toEqual({ model_key: "sonnet", agent_id: "a1", apply_scope: "agent" });
    expect(parsePlanActionParams("send_message", { recipient: "the supplier" })).toBeNull();
  });
});
