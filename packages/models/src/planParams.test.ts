/**
 * The plan action params the compilers write and the executors read (audit VRB-X1, verify-api-services-x1): one schema
 * per action, the roadmap item an instruction names, and the field-level change it asks for.
 */
import { PLAN_ACTION_TYPES } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { compilePlanRuleBased } from "./mock/planCompiler";
import { matchRoadmapItem, PLAN_ACTION_PARAMS, quarterBounds, resolveRoadmapItem, roadmapPatchFrom, SetAgentModelParams, UpdateRoadmapParams } from "./planParams";

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
