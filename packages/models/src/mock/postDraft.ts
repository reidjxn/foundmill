/**
 * Mock post draft (docs/NETWORK.md F3, F7): the social agent's post for the founder to share by tap, built from the
 * same facts the live request carries (packages/agents `buildPostDraftRequest`) and within the same rules, so the
 * local stack and the Playwright suite exercise the whole path without a key. Deterministic: the project's name, what
 * happened, and the page's own one-line pitch where it fits. No number, name, link, hashtag or praise is added.
 *
 * Input: `{ post_request: { project_name, fact: { trigger, subject, label }, max_chars } }` (trusted JSON) and
 * `{ project_page: { pitch, ... } }` (the published page's own words, as untrusted data).
 */
import type { PostDraftOutput } from "../schemas";
import type { MockContext } from "./inputs";

const text = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const sentence = (s: string): string => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** The post-draft request: the schema asks for `text` and `short`, and the prompt carries a `post_request`. */
export function isPostDraftRequest(ctx: MockContext): boolean {
  return ctx.schemaKeys.includes("text") && ctx.schemaKeys.includes("short") && ctx.getRecord("post_request") !== undefined;
}

/** A pitch that can go into a post as it is: no address, no link, no hashtag, no markup. */
const plainPitch = (pitch: string): boolean => pitch.length > 0 && !/https?:|www\.|[@#<>[\]]|\b[a-z0-9-]+\.[a-z]{2,}\//i.test(pitch);

const OPENING: Record<string, (name: string) => string> = {
  page_live: (name) => `${name} has a page now`,
  first_follower: (name) => `${name} has its first follower`,
};

export function generatePostDraft(ctx: MockContext): PostDraftOutput {
  const req = ctx.getRecord("post_request") ?? {};
  const page = ctx.getRecord("project_page") ?? {};
  const fact = isRecord(req.fact) ? req.fact : {};
  const name = text(req.project_name) || "This project";
  const label = text(fact.label);
  const max = typeof req.max_chars === "number" && req.max_chars > 0 ? req.max_chars : 200;
  const about = OPENING[text(fact.subject)] ?? OPENING.page_live!;
  const opening = sentence(label && text(fact.trigger) === "milestone_shown" ? `${name} reached a milestone: ${label}` : about(name));
  const pitch = text(page.pitch);
  const withPitch = plainPitch(pitch) && pitch.toLowerCase() !== name.toLowerCase() ? `${opening} ${sentence(pitch)}` : opening;
  return { text: withPitch.length <= max ? withPitch : opening, short: "" };
}
