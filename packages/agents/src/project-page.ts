/**
 * A project's public page, drafted by the team (docs/THESIS_REVIEW.md package 1.2). The first step of the foundations
 * after commit, before the vision: the Product lead drafts the page from the founder's own words, the founder checks it
 * and publishes it (publishing is never an agent's act: no tool reaches `page.publish`).
 *
 * Pure, like the rest of this package: the request (`buildProjectPageRequest`), the check of the answer against the
 * shared page schema (`finaliseProjectPage`), the deterministic draft every failure falls back to
 * (`starterProjectPage`, the same `starterPageDraft` apps/api's `page.get` builds) and the Product lead's note
 * (`projectPageReadyNote`). ./foundations-steps.ts runs the call through the client it is given.
 */
import { APP_NAME } from "@foundmill/config";
import { PAGE_READY_NOTE, ProjectPageDraft, pageContentProblems, starterPageDraft, type ProjectPageContent } from "@foundmill/shared";
import { ProjectPageOutput } from "@foundmill/models/schemas";
import { foundationsSystem, inertJson, plainModelText, untrustedBlock, type FoundationsInputs } from "./foundations";
import { projectPagePrompt } from "./prompts/project-page";
import type { RouteKey } from "./types";

export const PROJECT_PAGE_ROUTE = "projectPage" as const satisfies RouteKey;
/**
 * The usage ledger's `kind` for the page call: booked to the business like the foundations calls (the Product lead,
 * an Estimate), kept apart from them so the foundations summary counts only its own calls.
 */
export const PROJECT_PAGE_USAGE_KIND = "project_page";
/** What the limiter books for the call: a page is a few hundred tokens of JSON after a short, low-effort think. */
export const PROJECT_PAGE_RESERVE_TOKENS = 1_200;

export interface ProjectPageRequest {
  route: typeof PROJECT_PAGE_ROUTE;
  system: string[];
  messages: { role: "user"; content: string }[];
  schema: typeof ProjectPageOutput;
  reserveTokens: number;
}

/**
 * The house rules and the Product lead's instructions, then the page prompt (system); the founder's own words as
 * trusted JSON and the idea card (model-written) inside <untrusted_content> (the user turn). The founder profile is not
 * sent: the page names nobody ("Built by" is the founder's own switch, drawn from the owners' names, never the model's).
 */
export function buildProjectPageRequest(inputs: FoundationsInputs): ProjectPageRequest {
  const idea = inputs.idea;
  const trusted = { business_name: inputs.businessName, founder_words: idea?.founderWords ?? null, brief: idea?.brief ?? null };
  const parts = ["```json\n" + inertJson(trusted) + "\n```"];
  if (idea && (idea.title || idea.pitch)) parts.push(untrustedBlock("idea", { idea_card: { title: idea.title, pitch: idea.pitch } }));
  parts.push("Draft the page now.");
  return {
    route: PROJECT_PAGE_ROUTE,
    system: [foundationsSystem(inputs), projectPagePrompt.render({ business_name: inputs.businessName })],
    messages: [{ role: "user", content: parts.join("\n\n") }],
    schema: ProjectPageOutput,
    reserveTokens: PROJECT_PAGE_RESERVE_TOKENS,
  };
}

/** The founder's own words, as the starter draft and `page.get` read them: the card they wrote or edited, else the brief. */
export function pageFounderWords(inputs: Pick<FoundationsInputs, "idea">): string | null {
  return inputs.idea?.founderWords ?? inputs.idea?.brief ?? null;
}

/** The draft every failure falls back to: the shared starter, built from the founder's words and the project's name. */
export function starterProjectPage(inputs: Pick<FoundationsInputs, "idea" | "businessName">): ProjectPageContent {
  return starterPageDraft({ businessName: inputs.businessName, founderWords: pageFounderWords(inputs) });
}

/** Why a model answer was not used (the starter draft is used instead; logged and audited, never shown). */
export type ProjectPageRefusal = "markup" | "limits" | "invented_figure";

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;
const numbersIn = (text: string): string[] => (text.match(NUMBER_RE) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, ""));

/**
 * Figures in the draft that the founder did not give (a price, a count, a year): the page must not invent any. Only the
 * founder's own words and the project's name count; the idea card is the Ideation agent's text, and a figure in it is
 * as unproven as one the page would make up.
 */
export function inventedFigures(draft: Pick<ProjectPageContent, "pitch" | "about" | "forWhom">, inputs: Pick<FoundationsInputs, "idea" | "businessName">): string[] {
  const idea = inputs.idea;
  const known = new Set(numbersIn([inputs.businessName, idea?.founderWords ?? "", idea?.brief ?? ""].join("\n")));
  return [...new Set(numbersIn([draft.pitch, draft.about, draft.forWhom].join("\n")))].filter((n) => !known.has(n));
}

/**
 * The model's answer as a page draft, or why it cannot be used. Every field must already be plain text (a link, an
 * address or markup means the answer is not used, rather than published with "(link removed)" in it), within the
 * shared page schema's limits with a pitch and an about, and carry no figure the inputs did not give. `showFounders`
 * is always false: naming the people is the founder's choice.
 */
export function finaliseProjectPage(json: unknown, inputs: Pick<FoundationsInputs, "idea" | "businessName">): { draft: ProjectPageContent } | { refused: ProjectPageRefusal } {
  const parsed = ProjectPageOutput.safeParse(json);
  if (!parsed.success) return { refused: "limits" };
  const { pitch, about, for_whom: forWhom, stage } = parsed.data;
  if ([pitch, about, forWhom].some((s) => plainModelText(s) !== s)) return { refused: "markup" };
  const draft = ProjectPageDraft.safeParse({ pitch, about, forWhom, stage, showFounders: false });
  if (!draft.success || Object.keys(pageContentProblems(draft.data)).length > 0) return { refused: "limits" };
  if (inventedFigures(draft.data, inputs).length > 0) return { refused: "invented_figure" };
  return { draft: { ...draft.data, showFounders: false } };
}

/** One option of the page note, in the Composer schema's shape. */
export interface PageNoteOption {
  id: string;
  label: string;
  recommended: boolean;
  consequence: string;
  cost_minor: number;
  reversible: boolean;
  because?: string;
}

export interface ProjectPageNote {
  subject: string;
  bodyMd: string;
  options: PageNoteOption[];
}

/**
 * The Product lead's note once the draft exists (package 1.3): what the page is in one line, and a decision that never
 * holds Continue and is not a sign-off. "Check it and publish" opens Product › Public page; "Later" puts it aside, and
 * Today keeps its quiet line to the page.
 */
export function projectPageReadyNote(): ProjectPageNote {
  return {
    subject: PAGE_READY_NOTE.subject,
    bodyMd: `I drafted a public page for your project from your own words: one line on what it is, a few lines about it and who it is for. Nothing is public until you publish it, and then it has its own ${APP_NAME} address you can send to anyone.`,
    options: [
      { id: PAGE_READY_NOTE.options.check, label: PAGE_READY_NOTE.checkLabel, recommended: true, consequence: "Opens Product › Public page, where you can change any word and publish it when it reads right.", because: "Recommended because it takes a few minutes and gives you a link to send.", cost_minor: 0, reversible: true },
      { id: PAGE_READY_NOTE.options.later, label: PAGE_READY_NOTE.laterLabel, recommended: false, consequence: "Nothing changes. Today keeps a line to the page for whenever you are ready.", cost_minor: 0, reversible: true },
    ],
  };
}
