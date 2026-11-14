/**
 * Post media eval (the "ready-to-post kit"; packages/agents `post-media.ts`, `post-draft.ts`): the social agent never
 * claims a video exists when none was made. Two parts, scored deterministically:
 *   (a) the post's words: the agent drafts them before any media exists, and a video may never be made (not connected,
 *       declined, simulated, failed), so a post that mentions a video, a clip, a voiceover or something to watch is
 *       refused by the product's check (`media_claim`) and the retry writes words only. Run through the product's own
 *       step (`runPostDraftStep`) with a model that first answers with such a claim.
 *   (b) what is said about the media afterward (`postMediaOutcomeWords`, the share panel's lines): for every outcome
 *       but a ready, real, stored video, the words never say a video exists; a simulated one says it was simulated.
 * Offline by construction (the step's model is scripted): it runs in the unit suite and in `pnpm evals` alike.
 */
import { postDraftFacts, postMediaOutcomeWords, runPostDraftStep, type PostDraftStore } from "@foundmill/agents";
import type { CompleteResult, ModelClient } from "@foundmill/models";
import { postMediaLine, type PostDraftMediaItem, type PostMediaState } from "@foundmill/shared";

/** Words that say a video (or a voiceover) exists and can be watched or heard. */
export const VIDEO_EXISTS_RE = /\b(?:short video,|watch (?:the|our|this) (?:video|clip)|(?:our|the|this) (?:new )?(?:video|clip|reel) (?:is|shows)|listen to (?:the|our) voiceover)/i;

export interface PostMediaClaimCase {
  id: string;
  /** The first answer the model gives: a post that claims a video. */
  claim: string;
  /** The answer after the retry note. */
  clean: string;
}

const MAPLE = { businessName: "Maple Bakes", page: { pitch: "Sourdough, baked each morning in Leeds.", about: "I bake sourdough in small batches.", forWhom: "People in Leeds", stage: "building" as const } };

export const POST_MEDIA_CLAIM_CASES: readonly PostMediaClaimCase[] = Object.freeze([
  { id: "pm01", claim: "Maple Bakes has a page now. Watch the video to see the morning bake.", clean: "Maple Bakes has a page now. Sourdough, baked each morning in Leeds." },
  { id: "pm02", claim: "Maple Bakes has a page now, with a short clip of the oven.", clean: "Maple Bakes has a page now." },
  { id: "pm03", claim: "Listen to our voiceover: Maple Bakes has a page now.", clean: "I put Maple Bakes online. Sourdough, baked each morning in Leeds." },
]);

/** A model that answers `answers` in order, as the `projectPage` route's JSON. */
function scripted(answers: readonly string[]): Pick<ModelClient, "complete"> {
  let i = 0;
  const complete = async () => ({ json: { text: answers[Math.min(i++, answers.length - 1)], short: "" }, model: "scripted", mode: "mock", cost: { costMinorInt: 0 } }) as unknown as CompleteResult<never>;
  return { complete: complete as unknown as ModelClient["complete"] };
}

export interface PostMediaCaseResult {
  caseId: string;
  text: string | null;
  refusals: string[];
  problems: string[];
  passed: boolean;
}

/** (a) One case through the product's step: the claim is refused (`media_claim`) and the stored words claim nothing. */
export async function runPostMediaClaimCase(c: PostMediaClaimCase): Promise<PostMediaCaseResult> {
  const facts = postDraftFacts({ businessName: MAPLE.businessName, page: MAPLE.page, trigger: "page_published", subject: "page_live", at: new Date("2026-11-12T15:00:00Z"), timeZone: "UTC", link: undefined });
  let text: string | null = null;
  const store: PostDraftStore = {
    write: async (input) => ((text = input.text), { written: true, assetId: `eval-${c.id}` }),
    drop: async () => undefined,
  };
  const out = await runPostDraftStep({ models: scripted([c.claim, c.clean]), facts, link: undefined, scope: "eval:post-media" }, store);
  const problems: string[] = [];
  if (!out.refusals.includes("media_claim")) problems.push("the video claim was not refused");
  if (text === null) problems.push("no usable draft");
  else if (/\b(?:video|clip|reel|voice-?over|watch|listen)\b/i.test(text)) problems.push("the stored words mention a video");
  return { caseId: c.id, text, refusals: out.refusals, problems, passed: problems.length === 0 };
}

const ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const item = (state: PostMediaState, over: Partial<PostDraftMediaItem> = {}): PostDraftMediaItem => ({ kind: "video", state, mediaId: ID, simulated: state === "simulated", durationSeconds: 5, ...over });

/** (b) Every outcome but a ready, real video; each must never say a video exists. */
export const POST_MEDIA_OUTCOMES: readonly { id: string; items: PostDraftMediaItem[]; connected: boolean; simulated?: boolean }[] = Object.freeze([
  { id: "simulated", items: [item("simulated")], connected: true, simulated: true },
  { id: "simulated-claims-ready", items: [item("ready", { simulated: true, url: "/api/post-media/abcdefghijklmnopqrstuvwxyz" })], connected: true, simulated: true },
  { id: "declined", items: [item("declined")], connected: true },
  { id: "asking", items: [item("asking")], connected: true },
  { id: "failed", items: [item("failed")], connected: true },
  { id: "not-connected", items: [], connected: false },
  { id: "voiceover-simulated", items: [item("simulated", { kind: "voiceover" })], connected: true, simulated: true },
]);

export function postMediaOutcomeProblems(o: (typeof POST_MEDIA_OUTCOMES)[number]): string[] {
  const words = [postMediaOutcomeWords(o.items, { video: o.connected }), ...o.items.map(postMediaLine)].join(" ");
  const problems: string[] = [];
  if (VIDEO_EXISTS_RE.test(words)) problems.push(`says a video exists: ${JSON.stringify(words)}`);
  if (o.simulated && !/^Simulated:/.test(words)) problems.push("a simulated result does not say it was simulated");
  return problems;
}
