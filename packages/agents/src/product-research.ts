/**
 * Product research plan (BUILD §11.5 Research tab; the Product Researcher; the founder's 2026-10-18 request): as soon
 * as a new business's foundations are ready, the researcher plans how the specification and the direction will be
 * tested with the ICP, in parallel with the build. What the drafting reads (`ResearchPlanInputs`, loaded by packages/db
 * `repos.research.inputs`), the request it sends (`buildResearchPlanRequest`: the house rules and the researcher's
 * instructions with the prompt as the cached system prefix, the trusted inputs as JSON and the specification inside
 * <untrusted_content>, BUILD §9.8), the pure post-processing of the answer (`finaliseResearchPlan`: plain text, figures
 * labeled, one artifact per plan kind) and the researcher's Inbox note (`researchPlanNote`).
 *
 * Like the rest of this package nothing here calls a model: apps/api sends the request through its models client and
 * hands the answer back here.
 */
import { APP_NAME } from "@foundmill/config";
import { type Archetype, type ResearchArtifactKind } from "@foundmill/shared";
import { RESEARCH_PLAN_KINDS, ResearchPlanOutput } from "@foundmill/models/schemas";
import { buildSystemPrompt } from "./club-rules";
import { describeModelFailure, escapeMarkdown, inertJson, labelFigures, numbersIn, plainLine, plainModelText, untrustedBlock } from "./foundations";
import { productResearchPlanPrompt } from "./prompts/product-research";
import { getTemplate } from "./registry";
import type { RouteKey } from "./types";

// ---------------------------------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------------------------------

export interface ResearchPlanSection {
  section: string;
  /** The block's plain text (bounded by the loader). */
  text: string;
}

export interface ResearchPlanInputs {
  businessId: string;
  businessName: string;
  archetype: Archetype | null;
  currency: string;
  /** The ideal customer profile in one line: the Customers section's first sentence, else the vision's "for whom". */
  icp: string;
  visionStatement: string | null;
  targetMarkets: string[];
  constraints: string[];
  /** The roadmap's Now item titles, in order. */
  roadmapNow: string[];
  /** The specification sections in outline order, as plain text (at most ~6,000 characters in all). */
  sections: ResearchPlanSection[];
  /** The latest published specification version, when one exists. */
  specVersion: number | null;
  /** The agent the plan is attributed to: the Product Researcher, else the Researcher, else the Product lead. */
  researcherAgentId: string | null;
  researcherName: string | null;
}

export const RESEARCH_PLAN_ROUTE = "worker" as const satisfies RouteKey;
/** Five artifacts of a few hundred words each plus the assumptions and tasks: well inside the worker route's budget. */
export const RESEARCH_PLAN_MAX_TOKENS = 12_000;
export const RESEARCH_PLAN_TEMPLATE_KEY = "product_researcher";
/** The ICP line when the specification says nothing usable yet. */
export const DEFAULT_ICP = "the customers the specification names";

// ---------------------------------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------------------------------

export interface ResearchPlanRequest {
  route: typeof RESEARCH_PLAN_ROUTE;
  system: string[];
  cacheSystem: true;
  messages: { role: "user"; content: string }[];
  schema: typeof ResearchPlanOutput;
  maxTokens: number;
}

/** The prompt's variables from the inputs (every list non-empty: the prompt requires it). */
export function researchPlanVariables(inputs: ResearchPlanInputs) {
  return {
    business_name: inputs.businessName,
    icp: inputs.icp || DEFAULT_ICP,
    target_markets: inputs.targetMarkets.length ? inputs.targetMarkets : ["its first market"],
    vision_statement: inputs.visionStatement || `${inputs.businessName} serves ${inputs.icp || DEFAULT_ICP}.`,
    roadmap_now: inputs.roadmapNow.length ? inputs.roadmapNow : ["the first roadmap item"],
    artifact_kinds: [...RESEARCH_PLAN_KINDS],
  };
}

/** The trusted inputs as a fenced JSON block (what the founder chose or typed and what the app computed). */
export function researchPlanTrustedBlock(inputs: ResearchPlanInputs): string {
  const v = researchPlanVariables(inputs);
  const trusted = {
    research_request: {
      business_name: v.business_name,
      archetype: inputs.archetype,
      currency: inputs.currency,
      icp: v.icp,
      target_markets: v.target_markets,
      constraints: inputs.constraints,
      vision_statement: v.vision_statement,
      roadmap_now: v.roadmap_now,
      artifact_kinds: v.artifact_kinds,
      spec_version: inputs.specVersion,
    },
  };
  return "```json\n" + inertJson(trusted) + "\n```";
}

/** The specification's text: model-written (and possibly founder-edited) content, so untrusted data. */
export function researchPlanUntrustedBlock(inputs: ResearchPlanInputs): string {
  return untrustedBlock("specification", { specification: { sections: inputs.sections.map((s) => ({ section: s.section, text: s.text.slice(0, 2000) })) } });
}

/**
 * The request: house rules + the Product Researcher's instructions + the prompt as the cached system prefix (the same
 * for every business's plan up to the variables), the trusted inputs and the specification as the user turn.
 */
export function buildResearchPlanRequest(inputs: ResearchPlanInputs): ResearchPlanRequest {
  const system = buildSystemPrompt({ businessName: inputs.businessName, appName: APP_NAME, template: getTemplate(RESEARCH_PLAN_TEMPLATE_KEY) });
  const prompt = productResearchPlanPrompt.render(researchPlanVariables(inputs));
  return {
    route: RESEARCH_PLAN_ROUTE,
    system: [`${system}\n\n## Task\n${prompt}`],
    cacheSystem: true,
    messages: [{ role: "user", content: [researchPlanTrustedBlock(inputs), researchPlanUntrustedBlock(inputs)].join("\n\n") }],
    schema: ResearchPlanOutput,
    maxTokens: RESEARCH_PLAN_MAX_TOKENS,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Finalize: plain text, figures labeled, kinds complete
// ---------------------------------------------------------------------------------------------------------------------

export interface ResearchArtifactDraftFinal {
  kind: ResearchArtifactKind;
  title: string;
  summary: string;
  bodyMd: string;
  /** True for a placeholder the finalizer wrote because the model left the kind out. */
  placeholder: boolean;
}

export interface ResearchPlan {
  icpSummary: string;
  assumptions: { assumption: string; fromSection: string; whyItMatters: string; testKind: ResearchArtifactKind }[];
  artifacts: ResearchArtifactDraftFinal[];
  firstSteps: { title: string; goal: string; acceptance: string[] }[];
  openQuestions: string[];
  notes: { missingKinds: ResearchArtifactKind[]; labelledFigures: number; droppedArtifacts: number };
}

const KIND_WORD: Record<ResearchArtifactKind, string> = {
  interview_plan: "interview plan",
  interview_script: "interview script",
  smoke_test: "smoke test",
  survey: "survey",
  demo_script: "demo script",
  demo: "demo",
  findings: "findings note",
};

/** The display word for an artifact kind ("interview plan", "smoke test"). */
export function researchArtifactWord(kind: ResearchArtifactKind): string {
  return KIND_WORD[kind];
}

/** Numbers the inputs state: figures that quote one of them are facts, not estimates. */
export function researchKnownNumbers(inputs: Pick<ResearchPlanInputs, "sections" | "visionStatement" | "icp" | "targetMarkets">): Set<string> {
  return numbersIn(JSON.stringify({ icp: inputs.icp, vision: inputs.visionStatement, markets: inputs.targetMarkets, sections: inputs.sections.map((s) => s.text) }));
}

/** A Markdown body made plain and labeled line by line (a heading or a list item keeps its marker). */
export function finaliseBody(body: string, known: ReadonlySet<string>): { text: string; labelled: number } {
  let labelled = 0;
  const lines = plainModelText(body)
    .split("\n")
    .map((line) => {
      const r = labelFigures(line.replace(/\s+$/, ""), known);
      if (r.labelled) labelled++;
      return r.text;
    });
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), labelled };
}

function placeholderArtifact(kind: ResearchArtifactKind, inputs: ResearchPlanInputs): ResearchArtifactDraftFinal {
  const word = KIND_WORD[kind];
  return {
    kind,
    title: `To be written: the ${word}`,
    summary: `The ${word} was not drafted with the plan; the Product Researcher writes it in its first research task.`,
    bodyMd: `## To be written\n\nThe ${word} for ${inputs.icp || DEFAULT_ICP} was not part of the first draft. It is written in the researcher's first task, from the assumptions listed with the plan.`,
    placeholder: true,
  };
}

/** Turn a validated model answer into what the api stores. Pure and deterministic. */
export function finaliseResearchPlan(output: ResearchPlanOutput, inputs: ResearchPlanInputs): ResearchPlan {
  const known = researchKnownNumbers(inputs);
  let labelledFigures = 0;
  const line = (s: string, max: number) => {
    const r = labelFigures(plainLine(s), known);
    if (r.labelled) labelledFigures++;
    return r.text.slice(0, max);
  };

  const seen = new Set<ResearchArtifactKind>();
  const artifacts: ResearchArtifactDraftFinal[] = [];
  let droppedArtifacts = 0;
  for (const a of output.artifacts) {
    if (seen.has(a.kind) || !(RESEARCH_PLAN_KINDS as readonly string[]).includes(a.kind)) {
      droppedArtifacts++;
      continue;
    }
    seen.add(a.kind);
    const body = finaliseBody(a.body_md, known);
    labelledFigures += body.labelled;
    artifacts.push({ kind: a.kind, title: line(a.title, 120), summary: line(a.summary, 300), bodyMd: body.text, placeholder: false });
  }
  const missingKinds = RESEARCH_PLAN_KINDS.filter((k) => !seen.has(k));
  for (const k of missingKinds) artifacts.push(placeholderArtifact(k, inputs));
  // Plan order: the kinds as the plan reads them (interviews, then the smoke test, the survey and the demo).
  artifacts.sort((a, b) => RESEARCH_PLAN_KINDS.indexOf(a.kind as (typeof RESEARCH_PLAN_KINDS)[number]) - RESEARCH_PLAN_KINDS.indexOf(b.kind as (typeof RESEARCH_PLAN_KINDS)[number]));

  const sectionNames = new Map(inputs.sections.map((s) => [s.section.toLowerCase(), s.section] as const));
  const assumptions = output.riskiest_assumptions.slice(0, 6).map((a) => {
    const from = plainLine(a.from_section).slice(0, 120);
    return { assumption: line(a.assumption, 400), fromSection: sectionNames.get(from.toLowerCase()) ?? from, whyItMatters: line(a.why_it_matters, 400), testKind: a.test_kind };
  });
  const firstSteps = output.first_steps.slice(0, 4).map((s) => ({
    title: line(s.title, 120),
    goal: finaliseBody(s.goal, known).text.replace(/\s+/g, " ").slice(0, 600),
    acceptance: s.acceptance.map((c) => line(c, 300)).filter(Boolean).slice(0, 4),
  }));
  const openQuestions = output.open_questions.map((q) => line(q, 400)).filter(Boolean).slice(0, 6);

  return {
    icpSummary: line(output.icp_summary, 400) || inputs.icp || DEFAULT_ICP,
    assumptions,
    artifacts,
    firstSteps: firstSteps.filter((s) => s.title && s.acceptance.length),
    openQuestions,
    notes: { missingKinds: [...missingKinds], labelledFigures, droppedArtifacts },
  };
}

/** What the founder reads when the plan's drafting fails (shown next to Try again). */
export function describeResearchFailure(err: unknown): string {
  return describeModelFailure(err, { subject: "The research plan", agent: "The Product Researcher", refusalHint: "Check the specification's Customers section, then try again." });
}

// ---------------------------------------------------------------------------------------------------------------------
// The Inbox note when the plan is ready
// ---------------------------------------------------------------------------------------------------------------------

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const clipWords = (s: string, n: number) => {
  const w = words(s);
  return w.length <= n ? s : `${w.slice(0, n).join(" ").replace(/[,;:]$/, "")}…`;
};
const clipChars = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** How many numbered questions an artifact body carries ("1. …" lines). */
export function countQuestions(bodyMd: string): number {
  return bodyMd.split("\n").filter((l) => /^\s*\d+\.\s+\S/.test(l)).length;
}

/** The first percentage or count in a smoke test's threshold section ("5%"), or null. */
export function smokeThreshold(bodyMd: string): string | null {
  const m = bodyMd.match(/\d+(?:\.\d+)?\s?%/);
  return m ? m[0].replace(/\s+/g, "") : null;
}

/**
 * The update the Product Researcher posts when the plan is ready (BUILD §11.3 note style: fact → why it matters →
 * ask; 60-180 words). Deterministic from the plan, so it needs no second model call and invents nothing.
 */
export function researchPlanNote(plan: ResearchPlan, icp: string): { subject: string; bodyMd: string } {
  const md = (s: string) => escapeMarkdown(plainLine(s));
  const who = icp || DEFAULT_ICP;
  const interview = plan.artifacts.find((a) => a.kind === "interview_plan");
  const smoke = plan.artifacts.find((a) => a.kind === "smoke_test");
  const survey = plan.artifacts.find((a) => a.kind === "survey");
  const questions = interview ? countQuestions(interview.bodyMd) : 0;
  const surveyQuestions = survey ? countQuestions(survey.bodyMd) : 0;
  const threshold = smoke ? smokeThreshold(smoke.bodyMd) : null;
  const drafted = plan.artifacts.filter((a) => !a.placeholder).length;
  const parts = [
    questions ? `an interview plan with ${questions} questions` : "an interview plan",
    "its script",
    threshold ? `a smoke test with a ${threshold} threshold (Estimate)` : "a smoke test",
    surveyQuestions ? `a ${surveyQuestions}-question survey` : "a survey",
    "a demo script",
  ];
  const riskiest = plan.assumptions[0];
  const lines = [
    `${drafted} artifacts are drafted on Product › Research for testing the specification with ${md(who)}: ${parts.join(", ")}.`,
    riskiest ? `The riskiest assumption comes from the ${md(riskiest.fromSection)} section: ${md(clipWords(riskiest.assumption, 30))} ${md(clipWords(riskiest.whyItMatters, 24))}` : `The assumptions are listed with the sections they come from.`,
    `Nothing is sent to anyone without your approval: recruiting, the page and the survey wait for you. ${plan.firstSteps.length ? `${plan.firstSteps.length} research tasks are on Development › Plan for the next cycles.` : ""}`.trim(),
    `Tell me which test to run first, or read the plan and ask for changes.`,
  ];
  if (plan.openQuestions[0]) lines.splice(3, 0, `First open question: ${md(clipWords(plan.openQuestions[0], 25))}`);
  let body = lines.join("\n\n");
  while (words(body).length > 180 && lines.length > 3) {
    lines.splice(lines.length - 2, 1);
    body = lines.join("\n\n");
  }
  if (words(body).length < 60) body = `${body}\n\nThe plan names, for each assumption, the specification section it comes from and the cheapest test that would move it; findings arrive as sources with quotes and a confidence, so the Product lead can propose changes you accept or reject.`;
  return { subject: clipChars(`How we'll test the specification with ${plainLine(who)}`, 80), bodyMd: body };
}
