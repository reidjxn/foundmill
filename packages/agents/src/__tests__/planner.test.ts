/**
 * What the Planner is given (WP-05 T5): the specification's text, the agent types on the team, and whether code can
 * land anywhere ("destination"). Before this the Planner received only section names, no team and no destination.
 */
import { describe, expect, it } from "vitest";
import { buildPlannerRequest, PLANNER_ACCEPTANCE_RULE, plannerConnected, PLANNER_NO_DESTINATION_RULE, PLANNER_SPEC_TEXT_BUDGET, PLANNER_SYSTEM_PROMPT, plannerDestination, plannerSpecSections, plannerWorkerTypes } from "../prompts/planner";

const parse = (message: string) => JSON.parse(message.replace(/^```json\n/, "").replace(/\n```$/, "")) as Record<string, unknown>;
const doc = (...paragraphs: string[]) => ({ type: "doc", content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })) });

describe("buildPlannerRequest", () => {
  it("carries the goal, the roadmap item, each section's text, the destination and the team's agent types", () => {
    const body = parse(buildPlannerRequest({ goal: "Let customers order online", roadmapItem: { id: "r1", title: "Ordering" }, sections: [{ section: "customers", text: "Bakeries with one shop." }], destination: "none", workerTypes: ["product_lead", "researcher"], connected: ["gmail"] }));
    expect(body).toEqual({ goal: "Let customers order online", roadmap_item: { id: "r1", title: "Ordering" }, spec_sections: [{ section: "customers", text: "Bakeries with one shop." }], destination: "none", worker_types: ["product_lead", "researcher"], connected: ["gmail"] });
    expect(parse(buildPlannerRequest({ goal: "g", roadmapItem: null, sections: [], destination: "github", workerTypes: [], connected: [] })).destination).toBe("github");
  });

  it("cuts the specification's text to the budget in total, in order, and keeps every section's name", () => {
    const long = "x".repeat(PLANNER_SPEC_TEXT_BUDGET - 10);
    const body = parse(buildPlannerRequest({ goal: "g", roadmapItem: null, sections: [{ section: "a", text: long }, { section: "b", text: "y".repeat(50) }, { section: "c", text: "z" }], destination: "none", workerTypes: [], connected: [] }));
    const sections = body.spec_sections as { section: string; text: string }[];
    expect(sections.map((s) => s.section)).toEqual(["a", "b", "c"]);
    expect(sections.reduce((n, s) => n + s.text.length, 0)).toBe(PLANNER_SPEC_TEXT_BUDGET);
    expect(sections[1]!.text).toBe("y".repeat(10));
    expect(sections[2]!.text).toBe("");
  });
});

describe("the Planner's inputs from the records", () => {
  it("joins the blocks of a section into one text, sections in the order they come", () => {
    expect(plannerSpecSections([{ section: "problem", content: doc("Chasing receipts takes a day.") }, { section: "customers", content: doc("Accountants") }, { section: "problem", content: doc("Clients are late.") }, { section: "empty", content: { type: "doc", content: [] } }])).toEqual([
      { section: "problem", text: "Chasing receipts takes a day.\nClients are late." },
      { section: "customers", text: "Accountants" },
      { section: "empty", text: "" },
    ]);
  });

  it("code has a destination only when a repository is chosen and pushing is on", () => {
    expect(plannerDestination(null)).toBe("none");
    // WP-07 T9: no repository, Sites on → the project's site; a repository with pushing off stays "none".
    expect(plannerDestination(null, { sites: true })).toBe("site");
    expect(plannerDestination({ writeEnabled: false }, { sites: true })).toBe("none");
    expect(plannerDestination({ writeEnabled: true }, { sites: true })).toBe("github");
    expect(PLANNER_SYSTEM_PROMPT).toContain('When destination is "site"');
    expect(plannerDestination({ writeEnabled: false })).toBe("none");
    expect(plannerDestination({ writeEnabled: true })).toBe("github");
  });

  it("the team's agent types, once each, never a background helper", () => {
    expect(plannerWorkerTypes([{ agentType: "researcher", layer: "worker" }, { agentType: "researcher", layer: "worker" }, { agentType: "chief_of_staff", layer: "chief" }, { agentType: "classifier", layer: "utility" }])).toEqual(["researcher", "chief_of_staff"]);
  });
});

describe("the Planner's system prompt", () => {
  it("plans no code when there is nowhere for it to go live, and says so once", () => {
    expect(PLANNER_NO_DESTINATION_RULE).toBe('When destination is "none" there is nowhere for code to go live yet: plan no task of kind code; plan the research, writing and decisions that move the goal, and say in one task\'s goal that building starts once the project has a place to publish.');
    expect(PLANNER_SYSTEM_PROMPT).toContain(PLANNER_NO_DESTINATION_RULE);
  });
});

describe("acceptance the team can meet (WP-05 T24)", () => {
  it("the system prompt keeps acceptance to the team's tools and the project's facts, once, and names what goes to the founder", () => {
    expect(PLANNER_SYSTEM_PROMPT.split(PLANNER_ACCEPTANCE_RULE).length - 1).toBe(1);
    expect(PLANNER_ACCEPTANCE_RULE).toContain("Never require a record in a tool that is not connected");
    expect(PLANNER_ACCEPTANCE_RULE).toContain("a fact the founder has not given (a sender name");
    expect(PLANNER_ACCEPTANCE_RULE).toContain('"For the founder: ..."');
  });

  it("connected lists the project's connected or degraded connectors, once each, never an archived or disconnected one", () => {
    expect(plannerConnected([
      { connectorKey: "gmail", status: "connected", archivedAt: null },
      { connectorKey: "gmail", status: "connected", archivedAt: null },
      { connectorKey: "notion", status: "degraded", archivedAt: null },
      { connectorKey: "hubspot", status: "disconnected", archivedAt: null },
      { connectorKey: "github", status: "connected", archivedAt: new Date() },
    ])).toEqual(["gmail", "notion"]);
  });
});
