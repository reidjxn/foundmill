/**
 * Mock project page (package 1.2): the Product lead's first draft of a project's public page, read from the founder's
 * own words in the request (packages/agents `buildProjectPageRequest`), never a canned page. Mock-mode founders see
 * their own idea on the page: the pitch is its first sentence, "about" is the idea as written, "Who it is for" is the
 * audience the words name after "for" (empty when they name none), and the stage is "idea" unless the words say the
 * project is already being built or already live.
 *
 * Input: `{ business_name, founder_words, brief }` (trusted JSON) and `{ idea_card: { title, pitch } }` (the Ideation
 * agent's card, untrusted; used only when the founder wrote nothing).
 */
import { PAGE_ABOUT_MAX, PAGE_FOR_WHOM_MAX, PAGE_PITCH_MAX, clipText, firstSentence, normalizePageText, type PageStage } from "@foundmill/shared";
import type { ProjectPageOutput } from "../schemas";
import type { MockContext } from "./inputs";

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The audience the words name: what follows the first "for" up to the end of its clause ("for students in Leeds"). */
export function audienceOf(words: string): string {
  const m = /\bfor\s+((?:the\s+|people\s+|anyone\s+)?[^.;:!?\n]{3,200})/i.exec(words);
  if (!m) return "";
  const phrase = m[1]!.replace(/\s+(?:who|that|to|so|because|and then)\b.*$/i, "").replace(/[\s,]+$/g, "").trim();
  if (!phrase || /^(?:a|an|the|it|this|that|now|free|sale|me|us)$/i.test(phrase)) return "";
  return clipText(phrase.charAt(0).toUpperCase() + phrase.slice(1), PAGE_FOR_WHOM_MAX);
}

/** "idea", unless the founder says it is already being built or already live. */
export function stageOf(words: string): PageStage {
  if (/\b(?:already (?:live|selling|launched|open)|we launched|i launched|is live|are live)\b/i.test(words)) return "live";
  if (/\b(?:already (?:building|built|making|have a prototype)|a prototype|in beta|we are building|we're building|i am building|i'm building)\b/i.test(words)) return "building";
  return "idea";
}

export function generateProjectPage(ctx: MockContext): ProjectPageOutput {
  const founderWords = text(ctx.getString("founder_words"));
  const brief = text(ctx.getString("brief"));
  const card = ctx.getRecord("idea_card", "card") ?? {};
  const cardPitch = text(card.pitch);
  const name = text(ctx.getString("business_name")) ?? text(card.title) ?? "This project";
  const own = founderWords ?? brief;
  const source = own ?? cardPitch ?? name;
  const pitch = clipText(firstSentence(source), PAGE_PITCH_MAX) || clipText(name, PAGE_PITCH_MAX);
  const about = clipText(normalizePageText(source), PAGE_ABOUT_MAX) || pitch;
  return { pitch, about, for_whom: own ? audienceOf(own) : "", stage: own ? stageOf(own) : "idea" };
}
