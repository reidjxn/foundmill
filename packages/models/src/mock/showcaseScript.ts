/**
 * Mock showcase script (docs/THESIS_REVIEW.md §13 item 15): the house's social agent's script for a short video about a
 * project, built from the same facts the live request carries (packages/agents `buildShowcaseScriptRequest`) and within
 * the same rules, so the local stack and the suites exercise the whole path without a key. Deterministic: one shot per
 * card ("Nov 12: page live"), and a post that names the project through the placeholder `%project%` (never the name
 * itself) and its dated milestones. No number but the dates, no
 * person, no count and no ranking is added.
 *
 * Input: `{ showcase_request: { cards: [{ card, key, on, on_short }], max_chars } }` (trusted JSON) and
 * `{ project_story: { project_name, cards: [{ card, label }] } }` (the founders' name and the cards' words, as untrusted data).
 */
import type { ShowcaseScriptOutput } from "../schemas";
import type { MockContext } from "./inputs";

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The showcase request: the schema asks for `shots` and `post`, and the prompt carries a `showcase_request`. */
export function isShowcaseScriptRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("shots") && ctx.schemaKeys.includes("post") && ctx.getRecord("showcase_request") !== undefined;
}

export function generateShowcaseScript(ctx: MockContext): ShowcaseScriptOutput {
  const req = ctx.getRecord("showcase_request") ?? {};
  const story = ctx.getRecord("project_story") ?? {};
  // The name is never written: the placeholder goes where it does, and the product puts the name in.
  const name = "%project%";
  const labels = new Map((Array.isArray(story.cards) ? story.cards : []).filter(isRecord).map((c) => [text(c.card), text(c.label)]));
  const cards = (Array.isArray(req.cards) ? req.cards : []).filter(isRecord).slice(0, 3).map((c): Record<string, unknown> => ({ ...c, label: labels.get(text(c.card)) ?? "" }));
  const max = typeof req.max_chars === "number" && req.max_chars > 0 ? req.max_chars : 240;
  const shots = cards.map((c) => ({ card: text(c.card) || "c1", caption: `${text(c.on_short)}: ${text(c.label).toLowerCase()}` }));
  const lines = cards.map((c) => `${text(c.label)} on ${text(c.on)}.`);
  const full = `How ${name} was built. ${lines.join(" ")}`;
  const post = full.length <= max ? full : `How ${name} was built. ${lines[0] ?? ""}`.trim();
  return { shots: shots.length ? shots : [{ card: "c1", caption: name }], post };
}
