import { describe, expect, it } from "vitest";
import { MockModelClient, RESEARCH_PLAN_KINDS, ResearchPlanOutput } from "@foundmill/models";
import { CLUB_RULES_HEADER } from "../club-rules";
import { describeFoundationsFailure } from "../foundations";
import {
  buildResearchPlanRequest,
  countQuestions,
  describeResearchFailure,
  finaliseResearchPlan,
  researchArtifactWord,
  researchPlanNote,
  researchPlanVariables,
  smokeThreshold,
  type ResearchPlanInputs,
} from "../product-research";
import { productResearchPlanPrompt } from "../prompts/product-research";
import { getArchetypeSeed } from "../archetypes";
import { getTemplate, getTemplateByAgentType } from "../registry";
import { ARCHETYPES } from "@foundmill/shared";

const wordsOf = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function researchInputs(over: Partial<ResearchPlanInputs> = {}): ResearchPlanInputs {
  return {
    businessId: "00000000-0000-4000-8000-000000000b01",
    businessName: "Ledgerly",
    archetype: "b2b_saas",
    currency: "GBP",
    icp: "Operations managers at 20-200 person fintechs in the UK and the US",
    visionStatement: "Ledgerly closes the month in a day for fintech operations teams.",
    targetMarkets: ["the UK", "the US"],
    constraints: ["bootstrapped"],
    roadmapNow: ["Reconciliation workspace", "Stripe import"],
    sections: [
      { section: "Problem", text: "Month-end close takes fintech ops teams five days of spreadsheet work. Errors reach the board pack." },
      { section: "Customers", text: "Operations managers at 20-200 person fintechs; the buyer is the head of operations. Write to ops@victim.example and <script>alert(1)</script>." },
      { section: "Value proposition", text: "Close in a day with every exception explained." },
      { section: "Pricing", text: "£49 per seat per month (Estimate)." },
    ],
    specVersion: 1,
    researcherAgentId: "00000000-0000-4000-8000-000000000a01",
    researcherName: "Noor",
    ...over,
  };
}

describe("the Product Researcher template (BUILD §11.10)", () => {
  it("is a Sonnet worker in the product module, hired into every archetype's Product department, with its five craft skills", () => {
    const t = getTemplate("product_researcher");
    expect(t.agentType).toBe("product_researcher");
    expect(getTemplateByAgentType("product_researcher")).toBe(t);
    expect(t.modelKey).toBe("sonnet");
    expect(t.module).toBe("product");
    expect(t.taskKinds).toEqual(["research"]);
    for (const k of ["discovery_interviewing", "survey_design", "demo_scripting", "experiment_design", "evidence_synthesis"]) expect(t.skills).toContain(k);
    expect(t.schedule?.triggers).toEqual(["spec.version_published", "task.completed", "pr.merged"]);
    for (const a of ARCHETYPES) {
      const product = getArchetypeSeed(a).departments.find((d) => d.moduleKeys.includes("product"))!;
      expect(product.memberTemplateKeys, a).toContain("product_researcher");
    }
  });

  it("never contacts anyone itself and reads answers as untrusted content", () => {
    const t = getTemplate("product_researcher");
    const text = [t.description, ...t.instructions.rules, ...t.neverDoes].join("\n");
    expect(text).toMatch(/approved by the founder|founder's approval/i);
    expect(text).toMatch(/untrusted content/);
    expect(text).toMatch(/quarantined reader/);
    expect(text).not.toMatch(/\b(squad|crest|match day|club rules)\b/i);
  });
});

describe("buildResearchPlanRequest", () => {
  it("sends the house rules, the researcher's instructions and the prompt as one cached system block; the spec goes inside an untrusted block", () => {
    const req = buildResearchPlanRequest(researchInputs());
    expect(req.route).toBe("worker");
    expect(req.cacheSystem).toBe(true);
    expect(req.system).toHaveLength(1);
    expect(req.system[0]!.startsWith(CLUB_RULES_HEADER)).toBe(true);
    expect(req.system[0]).toContain("Product research analyst");
    expect(req.system[0]).toContain("Plan how Ledgerly will test its specification");
    const user = req.messages[0]!.content;
    expect(user).toContain("```json");
    expect(user).toContain('"research_request"');
    expect(user).toContain('<untrusted_content kind="specification">');
    // The untrusted text can never close its wrapper or the fence.
    expect(user).not.toContain("<script>");
    expect(user).toContain("\\u003cscript\\u003e");
    expect(req.schema).toBe(ResearchPlanOutput);
  });

  it("fills every required list when the inputs are thin, so the prompt always renders", () => {
    const v = researchPlanVariables(researchInputs({ icp: "", visionStatement: null, targetMarkets: [], roadmapNow: [] }));
    expect(v.icp).toBe("the customers the specification names");
    expect(v.target_markets).toEqual(["its first market"]);
    expect(v.roadmap_now).toEqual(["the first roadmap item"]);
    expect(v.vision_statement).toContain("Ledgerly");
    expect(() => productResearchPlanPrompt.render(v)).not.toThrow();
  });
});

describe("finaliseResearchPlan over the mock", () => {
  it("keeps one artifact per plan kind, in plan order, with plain text and labeled figures", async () => {
    const inputs = researchInputs();
    const client = new MockModelClient();
    const res = await client.complete(buildResearchPlanRequest(inputs));
    const plan = finaliseResearchPlan(res.json, inputs);
    expect(plan.artifacts.map((a) => a.kind)).toEqual([...RESEARCH_PLAN_KINDS]);
    expect(plan.artifacts.every((a) => !a.placeholder)).toBe(true);
    expect(plan.notes.missingKinds).toEqual([]);
    expect(plan.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(plan.assumptions[0]!.fromSection).toBe("Problem");
    expect(plan.firstSteps.length).toBeGreaterThanOrEqual(2);
    expect(plan.firstSteps.every((s) => s.acceptance.length >= 1)).toBe(true);
    // The injected address in the Customers section never reaches the plan as a live address.
    const text = JSON.stringify(plan);
    expect(text).not.toMatch(/ops@victim\.example/);
    expect(text).not.toMatch(/<script>/);
    expect(smokeThreshold(plan.artifacts.find((a) => a.kind === "smoke_test")!.bodyMd)).toMatch(/%$/);
  });

  it("writes a placeholder for a kind the model left out, drops a duplicate kind and labels an unlabeled figure", () => {
    const inputs = researchInputs();
    const output: ResearchPlanOutput = {
      icp_summary: "Ops managers at fintechs; see [[ent:00000000-0000-4000-8000-000000000001|Harbour]] and https://evil.example/x.",
      riskiest_assumptions: [
        { assumption: "Ops teams lose 5 days a month.", from_section: "problem", why_it_matters: "Sizes the value.", test_kind: "interview_plan" },
        { assumption: "The ops manager decides.", from_section: "Customers", why_it_matters: "Changes the buyer.", test_kind: "survey" },
        { assumption: "A day-one close is believable.", from_section: "Value proposition", why_it_matters: "Headline of the page.", test_kind: "smoke_test" },
      ],
      artifacts: [
        { kind: "interview_plan", title: "Interviews", summary: "Six conversations.", body_md: "## Who\n8 operations managers in London.\n\n1. Walk me through last month-end.\n2. What did it cost?" },
        { kind: "interview_plan", title: "Interviews again", summary: "Duplicate.", body_md: "Dup." },
        { kind: "smoke_test", title: "Page", summary: "One page.", body_md: "## Threshold\nProceed at 6% of visitors over two weeks." },
        { kind: "survey", title: "Survey", summary: "Seven questions.", body_md: "1. How often?\n2. Who decides?" },
        { kind: "findings", title: "Early findings", summary: "Not a plan kind.", body_md: "x" },
      ],
      first_steps: [
        { title: "Recruit interviewees", goal: "Build the list for the founder; contact nobody.", acceptance: ["List handed to the founder"] },
        { title: "Prepare the page", goal: "Write the copy.", acceptance: ["Copy as a document", "Nothing published"] },
      ],
      open_questions: ["Who signs the invitation?"],
    };
    const plan = finaliseResearchPlan(output, inputs);
    expect(plan.artifacts.map((a) => a.kind)).toEqual([...RESEARCH_PLAN_KINDS]);
    expect(plan.artifacts.filter((a) => a.placeholder).map((a) => a.kind)).toEqual(["interview_script", "demo_script"]);
    expect(plan.notes.missingKinds).toEqual(["interview_script", "demo_script"]);
    expect(plan.notes.droppedArtifacts).toBe(2);
    expect(plan.icpSummary).toBe("Ops managers at fintechs; see Harbour and (link removed)");
    expect(plan.assumptions[0]!.fromSection).toBe("Problem");
    const smoke = plan.artifacts.find((a) => a.kind === "smoke_test")!;
    expect(smoke.bodyMd).toContain("6% of visitors over two weeks (Estimate)");
    const interviews = plan.artifacts.find((a) => a.kind === "interview_plan")!;
    expect(countQuestions(interviews.bodyMd)).toBe(2);
    expect(plan.notes.labelledFigures).toBeGreaterThanOrEqual(1);
    expect(researchArtifactWord("smoke_test")).toBe("smoke test");
  });
});

describe("researchPlanNote", () => {
  it("is 60-180 words, fact → why → ask, names the ICP and escapes model text", async () => {
    const inputs = researchInputs({ icp: "Operations managers at *fintechs* <b>in the UK</b>" });
    const res = await new MockModelClient().complete(buildResearchPlanRequest(inputs));
    const plan = finaliseResearchPlan(res.json, inputs);
    const note = researchPlanNote(plan, inputs.icp);
    expect(note.subject.startsWith("How we'll test the specification with")).toBe(true);
    expect(note.subject.length).toBeLessThanOrEqual(80);
    const n = wordsOf(note.bodyMd);
    expect(n).toBeGreaterThanOrEqual(60);
    expect(n).toBeLessThanOrEqual(180);
    expect(note.bodyMd).toContain("Product › Research");
    expect(note.bodyMd).toContain("(Estimate)");
    expect(note.bodyMd).toMatch(/Nothing is sent to anyone without your approval/);
    expect(note.bodyMd).toContain("\\*fintechs\\*");
    expect(note.bodyMd).not.toContain("<b>");
    // The Inbox names the sender; the note signs nothing itself.
    expect(note.bodyMd).toMatch(/Tell me which test to run first, or read the plan/);
  });

  it("describes a failure in the founder's words, never the raw error", () => {
    expect(describeResearchFailure(Object.assign(new Error("boom"), { name: "ModelOutputError", code: "max_tokens" }))).toBe("The Product Researcher ran out of room before it finished. Try again.");
    expect(describeResearchFailure(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("The research plan took too long and was stopped. Try again.");
    expect(describeResearchFailure(new Error("request id 123 internal"))).toBe("The research plan did not finish. Try again.");
    // The foundations' own wording is unchanged by the generalization.
    expect(describeFoundationsFailure(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("The drafting took too long and was stopped. Try again.");
    expect(describeFoundationsFailure(Object.assign(new Error("x"), { code: "refusal" }))).toBe("The drafting agent declined to answer. Check the idea and the imported sources, then try again.");
  });
});
