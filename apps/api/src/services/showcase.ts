/**
 * Showcase videos of real projects (docs/THESIS_REVIEW.md §13 item 15; approved by the network session, Nov 13, 2026;
 * migration 0105). Foundmill's own business (the house, `HOUSE_BUSINESS_ID`) asks a project with a real, public
 * milestone whether it may post a short video made only from the project's public story.
 *
 * - **Who asks.** Only people with an owner's standing in the house (`isOwnerRole`, never an example membership).
 *   A project is eligible only when its page is public, it shows a page-live or first-follower milestone recorded from
 *   a real event, it is not a sample or the house, it has no open ask, no ask in the last 30 days and no "no" in the
 *   last 90, and its founders have not switched "Foundmill may ask to feature this project" off (packages/shared
 *   `showcaseEligibility`; the default is one value in packages/config).
 * - **What the video is made of.** The public story only (`storyOf`, the views `storyBySlug` / `cardById` read): the
 *   name, the brand colors, the milestones' words and dates, the cards' tall images. The house social agent's step
 *   `showcaseScript` writes the shots and the post, and the code check refuses anything else (packages/agents).
 * - **The video.** Where Runway is connected on the house business (the house's own key), `generate_video_from_image`
 *   runs once per card through the gateway's generic tool call (connector `runway`, by name: nothing here imports a
 *   connector's code), as the house's social agent, and the gateway asks in the house's Needs you before spending.
 *   `get_video_task` then follows each clip. A mock (simulated) result stays simulated and never goes out for a yes;
 *   without Runway the request simply waits for its media. A storyboard is never sent for consent.
 * - **The ask.** Once the media is final, every person with an owner's standing in the project gets their own note in
 *   the project's Needs you (0105 `for_user_id`; the waiting-note email opens it) and answers it signed in. Each
 *   founder's row is theirs alone. An unanswered ask expires after 14 days; an approval lapses after 30.
 * - **From approval to post.** Every current founder's yes on the same video writes the house's draft post (trigger
 *   `showcase_approved`). It is shared only by a person's tap in the house, and only through `showcaseShareGate`:
 *   approved and in date, the draft's hash equal to the approved preview's, the same founders who said yes, the page
 *   and the milestones still public.
 * - **Revocation.** Any ONE founder's No, Withdraw or departure overrides the others' yes, before posting; so do expiry,
 *   the page going private, a milestone hidden, the setting switched off and a change in the founders. Each withdraws
 *   the video: the draft is set aside, the unposted media deleted, its links disabled; where a share of it was opened,
 *   the house gets a note naming the networks to take it down from by hand.
 * - **Events.** House: `showcase.requested`, `showcase.approved`, `showcase.withdrawn {reason}`. Project:
 *   `showcase.asked`, `showcase.settled {state}`. Ids only, never narrated, never one founder's answer.
 *
 * Both tables are written here only, on the service connection, after the caller's standing is checked.
 */
import { createHash } from "node:crypto";
import { runShowcaseScriptStep, showcaseScriptFacts } from "@foundmill/agents";
import { APP_NAME, HOUSE_BUSINESS_ID, showcaseMayAsk } from "@foundmill/config";
import { repos, type Db, type Executor, type ShowcaseConsent, type ShowcaseMedia, type ShowcaseRequest } from "@foundmill/db";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  SHOWCASE_APPROVAL_TTL_MS,
  SHOWCASE_ASK_TTL_MS,
  SHOWCASE_CONSENT_KEY,
  SHOWCASE_NETWORKS,
  SHOWCASE_SHARE_REFUSAL_WORDS,
  cardTallImagePath,
  isOwnerRole,
  isShowcaseMilestoneKey,
  isShowcaseOpen,
  settleShowcase,
  showcaseDraftCanonical,
  showcaseEligibility,
  showcaseLink,
  showcasePreviewCanonical,
  showcaseShareRefusal,
  showcaseWords,
  type Env,
  type PostDraft,
  type ShowcaseAnswer,
  type ShowcaseIneligible,
  type ShowcasePreview,
  type ShowcaseRequestState,
  type ShowcaseShareRefusal,
  type ShowcaseWithdrawReason,
} from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { writeEventRow } from "./events";
import type { ApiGatewayClient, GatewayToolCallOutcome } from "./gateway";
import type { ApiLogger } from "./log";
import { ungated } from "./tx-gate";

const WORDS = showcaseWords(APP_NAME);
const SYSTEM = { kind: "system", id: "api" } as const;

export interface ShowcaseDeps {
  db: Db;
  gateway: ApiGatewayClient;
  env: Pick<Env, "APP_URL">;
  log: ApiLogger;
  now?: () => Date;
  /** The house business's id; packages/config `HOUSE_BUSINESS_ID` unless a test names another. */
  houseId?: string;
}

const houseOf = (deps: Pick<ShowcaseDeps, "houseId">): string => deps.houseId ?? HOUSE_BUSINESS_ID;
const nowOf = (deps: Pick<ShowcaseDeps, "now">): Date => deps.now?.() ?? new Date();
export const previewHash = (preview: ShowcasePreview): string => createHash("sha256").update(showcasePreviewCanonical(preview)).digest("hex");
const draftHash = (preview: ShowcasePreview, body: string): string => createHash("sha256").update(showcaseDraftCanonical(preview, body)).digest("hex");

/** The Runway call the clip is made with: fixed words written here, never by a model, and the card's own picture. */
export const SHOWCASE_CLIP = {
  connector: "runway",
  startTool: "generate_video_from_image",
  taskTool: "get_video_task",
  prompt: "A slow, steady push-in on this card. Keep every word, date, color and the logo exactly as they are. No people, no faces, no new text.",
  ratio: "720:1280",
  durationSeconds: 5,
  model: "gen4_turbo",
  /** Runway's credits for the clip, in US cents (gen4_turbo, 5 credits a second): an Estimate the approval is asked for. */
  amountMinor: 25,
  currency: "USD",
} as const;

/** The sweep: asks that ran out, approvals that lapsed, clips to follow, founders who changed, every 10 minutes. */
export const SHOWCASE_SWEEP_MS = 10 * 60 * 1000;

const INELIGIBLE_WORDS: Readonly<Record<ShowcaseIneligible, string>> = {
  page_private: "This project's page is not public.",
  no_real_milestone: "This project shows no real page-live or first-follower milestone in public.",
  sample: "A sample project is never featured.",
  house: `${APP_NAME}'s own business is never featured.`,
  open_request: "This project already has an open ask.",
  recent_request: "This project was asked in the last 30 days.",
  recent_no: "This project's founders said no in the last 90 days.",
  setting_off: `This project's founders switched off "${WORDS.setting}".`,
};

// ---------------------------------------------------------------------------------------------------------------------
// Who may do what
// ---------------------------------------------------------------------------------------------------------------------

const isExample = (ctx: Pick<BusinessContext, "membership">): boolean => (ctx.membership as { source?: string }).source === "example";

/** The house's owners only: the house business, an owner's standing, never an example membership. */
export function assertHouseOwner(ctx: Pick<BusinessContext, "businessId" | "role" | "membership">, houseId: string = HOUSE_BUSINESS_ID): void {
  if (ctx.businessId !== houseId || !isOwnerRole(ctx.role) || isExample(ctx)) throw new ForbiddenError(`Only the owners of ${APP_NAME}'s own business can ask a project to be featured.`);
}

/** A project's founders only (an owner's standing), never an example membership. */
function assertFounder(ctx: Pick<BusinessContext, "role" | "membership">): void {
  if (!isOwnerRole(ctx.role) || isExample(ctx)) throw new ForbiddenError(WORDS.onlyFounders);
}

// ---------------------------------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------------------------------

export interface ShowcaseCandidate {
  businessId: string;
  name: string;
  slug: string;
  eligible: boolean;
  /** Why not, in plain words; null when eligible. */
  why: string | null;
}

async function eligibilityOf(db: Executor, houseId: string, subjectBusinessId: string, now: Date) {
  const f = await repos.showcase.eligibilityFacts(db, subjectBusinessId);
  const story = f.story;
  const decision = showcaseEligibility(
    {
      pagePublic: !!story && !!f.business && !f.business.archived,
      shownMilestones: (story?.milestones ?? []).map((m) => ({ key: m.key, simulated: f.shownSimulated.get(m.id) === true })),
      isSample: !f.business || f.business.isDemo,
      isHouse: subjectBusinessId === houseId,
      openRequest: f.openRequest,
      lastRequestAt: f.lastRequestAt,
      lastDeclinedAt: f.lastDeclinedAt,
      mayAsk: showcaseMayAsk(f.business?.showcaseMayAsk),
    },
    now,
  );
  return { decision, facts: f };
}

/** `showcase.candidates` (house owners): the projects that show a real milestone in public, and whether each may be asked. */
export async function listCandidates(ctx: BusinessContext, deps: Pick<ShowcaseDeps, "houseId" | "now"> = {}): Promise<ShowcaseCandidate[]> {
  const houseId = houseOf(deps);
  assertHouseOwner(ctx, houseId);
  const now = nowOf(deps);
  const out: ShowcaseCandidate[] = [];
  for (const id of await repos.showcase.candidateIds(ctx.db)) {
    const { decision, facts } = await eligibilityOf(ctx.db, houseId, id, now);
    if (!facts.business || !facts.story) continue;
    out.push({ businessId: id, name: facts.business.name, slug: facts.story.slug, eligible: decision.eligible, why: decision.eligible ? null : INELIGIBLE_WORDS[decision.reason] });
  }
  return out.sort((a, b) => Number(b.eligible) - Number(a.eligible) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------------------------------

/** What the house reads about a request: its overall state, never who said what. */
export interface ShowcaseRequestView {
  id: string;
  subjectBusinessId: string;
  state: ShowcaseRequestState;
  reason: ShowcaseWithdrawReason | null;
  preview: ShowcasePreview;
  /** Why the video is not final yet, or null. */
  waiting: ShowcaseMedia["waiting"] | null;
  askedAt: Date | null;
  expiresAt: Date | null;
  approvedUntil: Date | null;
  assetId: string | null;
  createdAt: Date;
}

const requestView = (r: ShowcaseRequest): ShowcaseRequestView => ({
  id: r.id,
  subjectBusinessId: r.subjectBusinessId,
  state: r.state,
  reason: r.withdrawReason ?? null,
  preview: r.preview,
  waiting: r.media.waiting ?? null,
  askedAt: r.askedAt,
  expiresAt: r.expiresAt,
  approvedUntil: r.approvedUntil,
  assetId: r.assetId,
  createdAt: r.createdAt,
});

/** `showcase.list` (house owners): the house's requests, newest first. */
export async function listRequests(ctx: BusinessContext, deps: Pick<ShowcaseDeps, "houseId"> = {}): Promise<ShowcaseRequestView[]> {
  assertHouseOwner(ctx, houseOf(deps));
  return (await ctx.rls((tx) => repos.showcase.listForHouse(tx, ctx.businessId))).map(requestView);
}

/**
 * `showcase.request` (house owners): checks the project again, writes the script from its public story (the house
 * social agent's `showcaseScript`; an answer the code check refuses twice is dropped and nothing is stored), stores the
 * request with its preview and starts the video. The ask goes to the founders only once the video is final.
 */
export async function requestShowcase(ctx: BusinessContext, input: { subjectBusinessId: string }, deps: Pick<ShowcaseDeps, "houseId" | "now"> = {}): Promise<ShowcaseRequestView> {
  const houseId = houseOf(deps);
  assertHouseOwner(ctx, houseId);
  const now = nowOf(deps);
  const db = ctx.db;
  const { decision, facts } = await eligibilityOf(db, houseId, input.subjectBusinessId, now);
  if (!decision.eligible) throw new AppError("showcase_not_eligible", INELIGIBLE_WORDS[decision.reason], 409);
  const story = facts.story!;
  const milestones = story.milestones.flatMap((m) => (isShowcaseMilestoneKey(m.key) && facts.shownSimulated.get(m.id) !== true ? [{ id: m.id, key: m.key, label: m.label, achievedAt: m.achievedAt }] : []));
  const scriptFacts = showcaseScriptFacts({ name: story.name, milestones });
  const agentId = await repos.showcase.socialAgentId(db, houseId);
  const step = await runShowcaseScriptStep({ models: ctx.models, facts: scriptFacts, scope: `showcase:${input.subjectBusinessId}`, attribution: { businessId: houseId, ...(agentId ? { agentId } : {}) }, log: ctx.log });
  if (step.outcome === "dropped") {
    ctx.log.warn({ subjectBusinessId: input.subjectBusinessId, reason: step.reason }, "showcase: the script was dropped");
    throw new AppError("showcase_script_dropped", "The team could not write a script that keeps to the facts. Nothing was stored; try again later.", 422);
  }
  const origin = ctx.env.APP_URL.replace(/\/+$/, "");
  const preview: ShowcasePreview = {
    slug: story.slug,
    projectName: story.name,
    brandPrimary: story.brandPrimary,
    brandSecondary: story.brandSecondary,
    shots: step.script.shots.map((s) => {
      const card = scriptFacts.cards.find((c) => c.milestoneId === s.milestoneId)!;
      return { milestoneId: card.milestoneId, key: card.key, label: card.label, on: card.on, imageUrl: `${origin}${cardTallImagePath(card.milestoneId)}`, caption: s.caption };
    }),
    postText: step.script.postText,
    link: showcaseLink(origin, story.slug),
    networks: [...SHOWCASE_NETWORKS],
    video: null,
  };
  const row = await db.transaction(async (tx) => {
    const created = await repos.showcase.createRequest(tx, { businessId: houseId, subjectBusinessId: input.subjectBusinessId, preview, previewHash: previewHash(preview), requestedByUserId: ctx.userId, media: { clips: [], waiting: null } });
    await writeEventRow(tx, { businessId: houseId, type: "showcase.requested", actor: { kind: "user", id: ctx.userId }, payload: { requestId: created.id, subjectBusinessId: input.subjectBusinessId } });
    await repos.audit.append(tx, houseId, { actorKind: "user", actorId: ctx.userId, action: "showcase.requested", target: { kind: "showcase_request", id: created.id }, details: { subjectBusinessId: input.subjectBusinessId } });
    return created;
  });
  queueShowcaseAdvance(engineDeps(ctx, deps), row.id);
  return requestView(row);
}

/** `showcase.withdraw` (house owners): the house takes its request back; nothing is posted. */
export async function withdrawByHouse(ctx: BusinessContext, input: { requestId: string }, deps: Pick<ShowcaseDeps, "houseId" | "now"> = {}): Promise<ShowcaseRequestView> {
  const houseId = houseOf(deps);
  assertHouseOwner(ctx, houseId);
  const request = await repos.showcase.getRequest(ctx.db, houseId, input.requestId);
  if (!request) throw new NotFoundError("showcase_request", input.requestId);
  await endShowcase(engineDeps(ctx, deps), request.id, "withdrawn", "house_withdrew");
  return requestView((await repos.showcase.getRequest(ctx.db, houseId, input.requestId))!);
}

const engineDeps = (ctx: BusinessContext, deps: Pick<ShowcaseDeps, "houseId" | "now">): ShowcaseDeps => ({ db: ctx.db, gateway: ctx.gateway, env: ctx.env, log: ctx.log, ...deps });

// ---------------------------------------------------------------------------------------------------------------------
// Ending a request: one founder's no or withdrawal, a change, expiry, or the house
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Ends an open request without a post, once: the state and the reason; the draft set aside; every founder's note
 * archived; the unposted media deleted and its links disabled; the house's `showcase.withdrawn {reason}` and, where the
 * ask had gone out, the project's `showcase.settled {state}`. Where a share of the draft was opened, the house gets a
 * note naming the networks to take it down from by hand. Returns false when the request was not open any more.
 */
export async function endShowcase(deps: ShowcaseDeps, requestId: string, state: "declined" | "withdrawn" | "expired", reason: ShowcaseWithdrawReason): Promise<boolean> {
  const now = nowOf(deps);
  const houseId = houseOf(deps);
  return deps.db.transaction(async (tx) => {
    const request = await repos.showcase.getRequest(tx, houseId, requestId, { forUpdate: true });
    if (!request || !isShowcaseOpen(request.state)) return false;
    if (!(await repos.showcase.endRequest(tx, request.id, state, reason, now))) return false;
    let sharedOn: string[] = [];
    if (request.assetId) {
      sharedOn = await repos.showcase.sharedOn(tx, houseId, request.assetId);
      await repos.showcase.rejectDraft(tx, houseId, request.assetId);
    }
    for (const note of await repos.showcase.noteIds(tx, request.id)) await repos.showcase.closeNote(tx, note.businessId, note.inboxItemId, "archived");
    await repos.showcase.deleteMedia(tx, request.id, now);
    await writeEventRow(tx, { businessId: houseId, type: "showcase.withdrawn", actor: SYSTEM, payload: { requestId: request.id, subjectBusinessId: request.subjectBusinessId, reason } });
    if (request.askedAt) await writeEventRow(tx, { businessId: request.subjectBusinessId, type: "showcase.settled", actor: SYSTEM, payload: { requestId: request.id, state } });
    if (sharedOn.length) {
      const networks = sharedOn.join(", ");
      await repos.showcase.createHouseNote(tx, houseId, { subject: WORDS.removeByHand(request.preview.projectName), bodyMd: WORDS.removeByHandBody(networks) });
    }
    return true;
  });
}

/** What the answers come to now; approves (writing the house's draft) or ends the request. Inside the caller's transaction, with the request locked. */
async function settleLocked(deps: ShowcaseDeps, tx: Executor, request: ShowcaseRequest, now: Date): Promise<{ end: { state: "declined" | "withdrawn" | "expired"; reason: ShowcaseWithdrawReason } | null }> {
  if (request.state !== "asking" || !request.askedAt) return { end: null };
  const consents = await repos.showcase.consentsOf(tx, request.id);
  const owners = await repos.showcase.currentOwnerIds(tx, request.subjectBusinessId);
  const settled = settleShowcase(consents.map((c) => ({ userId: c.userId, answer: c.answer, withdrawnAt: c.withdrawnAt, expiresAt: c.expiresAt })), owners, now);
  if (settled.state === "asking") return { end: null };
  if (settled.state !== "approved") return { end: { state: settled.state, reason: settled.reason } };
  const houseId = houseOf(deps);
  const agentId = await repos.showcase.socialAgentId(tx, houseId);
  const subject = request.preview.shots.at(-1)?.key ?? "page_live";
  const asset = await repos.showcase.createDraftPost(tx, houseId, { requestId: request.id, subject, text: request.preview.postText, agentId });
  await repos.showcase.updateRequest(tx, request.id, { state: "approved", approvedUntil: new Date(now.getTime() + SHOWCASE_APPROVAL_TTL_MS), assetId: asset.id, settledAt: now });
  await writeEventRow(tx, { businessId: houseId, type: "showcase.approved", actor: SYSTEM, payload: { requestId: request.id, subjectBusinessId: request.subjectBusinessId, assetId: asset.id } });
  await writeEventRow(tx, { businessId: request.subjectBusinessId, type: "showcase.settled", actor: SYSTEM, payload: { requestId: request.id, state: "approved" } });
  return { end: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The video, and the ask once it is final
// ---------------------------------------------------------------------------------------------------------------------

type Clip = NonNullable<ShowcaseMedia["clips"]>[number];

/** The data of an allowed call: a tool that returns third-party content answers inside its quarantine envelope. */
const dataOf = (out: Extract<GatewayToolCallOutcome, { outcome: "allow" }>): Record<string, unknown> => {
  const d = out.result.data as { untrusted?: boolean; content?: unknown } | undefined;
  const inner = d && d.untrusted === true && "content" in d ? d.content : d;
  return inner && typeof inner === "object" ? (inner as Record<string, unknown>) : {};
};

/** Whether Runway is connected on the house business, on the house's own key. */
async function runwayConnected(db: Executor, houseId: string): Promise<boolean> {
  const row = await repos.integrations.getByKey(db, houseId, SHOWCASE_CLIP.connector);
  return !!row && row.status === "connected" && row.archivedAt === null;
}

/** One step of the clips: start the ones not started (the gateway asks the house first), follow the ones running. */
async function advanceClips(deps: ShowcaseDeps, request: ShowcaseRequest): Promise<ShowcaseMedia> {
  const houseId = houseOf(deps);
  const media: ShowcaseMedia = { ...request.media, clips: [...(request.media.clips ?? [])] };
  if (!(await runwayConnected(deps.db, houseId)) || !deps.gateway.toolCall) return { ...media, waiting: "not_connected" };
  const agentId = await repos.showcase.socialAgentId(deps.db, houseId);
  if (!agentId) return { ...media, waiting: "not_connected" };
  for (const shot of request.preview.shots) {
    const at = media.clips!.findIndex((c) => c.milestoneId === shot.milestoneId);
    const clip: Clip = at >= 0 ? { ...media.clips![at]! } : { milestoneId: shot.milestoneId };
    if (clip.simulated || clip.failed || clip.status === "SUCCEEDED") {
      // nothing to do for this one
    } else if (!clip.taskId) {
      const out = await deps.gateway.toolCall({
        businessId: houseId,
        agentId,
        connector: SHOWCASE_CLIP.connector,
        tool: SHOWCASE_CLIP.startTool,
        args: { promptImageUrl: shot.imageUrl, prompt: SHOWCASE_CLIP.prompt, ratio: SHOWCASE_CLIP.ratio, durationSeconds: SHOWCASE_CLIP.durationSeconds, model: SHOWCASE_CLIP.model },
        context: { amountMinor: SHOWCASE_CLIP.amountMinor, currency: SHOWCASE_CLIP.currency },
      });
      if (out.outcome === "allow") {
        const taskId = typeof dataOf(out).taskId === "string" ? (dataOf(out).taskId as string) : null;
        if (out.result.simulated) clip.simulated = true;
        if (!out.result.ok || !taskId) clip.failed = !out.result.simulated;
        clip.taskId = taskId;
        clip.status = "PENDING";
      } else if (out.outcome === "ask") clip.approvalId = out.approvalId;
      else if (out.outcome === "deny") clip.failed = true;
    } else {
      const out = await deps.gateway.toolCall({ businessId: houseId, agentId, connector: SHOWCASE_CLIP.connector, tool: SHOWCASE_CLIP.taskTool, args: { taskId: clip.taskId } });
      if (out.outcome === "allow" && out.result.ok) {
        const data = dataOf(out);
        if (out.result.simulated) clip.simulated = true;
        clip.status = typeof data.status === "string" ? data.status : clip.status;
        const urls = Array.isArray(data.outputUrls) ? data.outputUrls.filter((u): u is string => typeof u === "string" && u.startsWith("https://")) : [];
        if (urls[0]) clip.url = urls[0];
        clip.urlsExpireAt = typeof data.urlsExpireAt === "string" ? data.urlsExpireAt : null;
        if (clip.status === "FAILED" || clip.status === "CANCELLED") clip.failed = true;
      }
    }
    if (at >= 0) media.clips![at] = clip;
    else media.clips!.push(clip);
  }
  const clips = media.clips!;
  const waiting = clips.some((c) => c.simulated) ? "simulated" : clips.some((c) => c.failed) ? "failed" : null;
  return { ...media, waiting };
}

/** The video is final: one real, finished clip per shot. A simulated clip never is. */
function finalClips(request: ShowcaseRequest, media: ShowcaseMedia): ShowcasePreview["video"] {
  const clips = request.preview.shots.map((s) => media.clips?.find((c) => c.milestoneId === s.milestoneId));
  if (clips.some((c) => !c || c.simulated || c.failed || c.status !== "SUCCEEDED" || !c.taskId || !c.url)) return null;
  return { clips: clips.map((c) => ({ milestoneId: c!.milestoneId, taskId: c!.taskId!, url: c!.url! })) };
}

/** Whether the project still is what it was asked for: page public, milestones shown, setting on. */
async function stillLive(db: Executor, request: ShowcaseRequest): Promise<ShowcaseWithdrawReason | null> {
  if (!(await repos.showcase.pagePublic(db, request.preview.slug))) return "page_private";
  if (!(await repos.showcase.milestonesShown(db, request.preview.slug, request.preview.shots.map((s) => s.milestoneId)))) return "milestone_hidden";
  if (!showcaseMayAsk(await repos.showcase.mayAskSetting(db, request.subjectBusinessId))) return "setting_off";
  return null;
}

/** Sends the final video to every founder: their own row, their own note in Needs you. With the request locked. */
async function sendAsks(deps: ShowcaseDeps, tx: Executor, request: ShowcaseRequest, video: NonNullable<ShowcasePreview["video"]>, media: ShowcaseMedia, now: Date): Promise<{ end: ShowcaseWithdrawReason | null }> {
  const owners = await repos.showcase.currentOwnerIds(tx, request.subjectBusinessId);
  if (owners.length === 0) return { end: "founders_changed" };
  const preview: ShowcasePreview = { ...request.preview, video };
  const hash = previewHash(preview);
  const expiresAt = new Date(now.getTime() + SHOWCASE_ASK_TTL_MS);
  for (const userId of owners) {
    const consent = await repos.showcase.createConsent(tx, { businessId: request.subjectBusinessId, requestId: request.id, userId, preview, previewHash: hash, expiresAt });
    const note = await repos.showcase.createNote(tx, request.subjectBusinessId, { forUserId: userId, subject: WORDS.subject(preview.projectName), bodyMd: WORDS.body, decision: { key: SHOWCASE_CONSENT_KEY, requestId: request.id, consentId: consent.id, options: [] } });
    await repos.showcase.linkNote(tx, consent.id, note.id);
  }
  await repos.showcase.updateRequest(tx, request.id, { preview, previewHash: hash, media, askedAt: now, expiresAt });
  await writeEventRow(tx, { businessId: request.subjectBusinessId, type: "showcase.asked", actor: SYSTEM, payload: { requestId: request.id } });
  return { end: null };
}

/**
 * One step for one open request, the only entry point of the engine (the sweep, the hooks and a new request call it):
 * end it if the project is no longer what it was asked for or the answers say so; otherwise move its video on and, once
 * the video is final, send the ask. Never throws: a failed step is logged and tried again by the next sweep.
 */
export async function advanceShowcase(deps: ShowcaseDeps, requestId: string): Promise<void> {
  const houseId = houseOf(deps);
  try {
    const request = await repos.showcase.getRequest(deps.db, houseId, requestId);
    if (!request || !isShowcaseOpen(request.state)) return;
    const now = nowOf(deps);
    const gone = await stillLive(deps.db, request);
    if (gone) {
      await endShowcase(deps, request.id, "withdrawn", gone);
      return;
    }
    if (request.state === "approved") {
      const owners = await repos.showcase.currentOwnerIds(deps.db, request.subjectBusinessId);
      const yes = (await repos.showcase.consentsOf(deps.db, request.id)).filter((c) => c.answer === "yes" && !c.withdrawnAt).map((c) => c.userId);
      if (!request.approvedUntil || request.approvedUntil.getTime() <= now.getTime()) await endShowcase(deps, request.id, "expired", "approval_lapsed");
      else if (owners.length !== yes.length || owners.some((o) => !yes.includes(o))) await endShowcase(deps, request.id, "withdrawn", "founders_changed");
      return;
    }
    if (request.askedAt) {
      const ended = await deps.db.transaction(async (tx) => {
        const locked = await repos.showcase.getRequest(tx, houseId, request.id, { forUpdate: true });
        return locked ? (await settleLocked(deps, tx, locked, now)).end : null;
      });
      if (ended) await endShowcase(deps, request.id, ended.state, ended.reason);
      return;
    }
    // Not asked yet: the video first.
    const media = await advanceClips(deps, request);
    const video = finalClips(request, media);
    const end = await deps.db.transaction(async (tx) => {
      const locked = await repos.showcase.getRequest(tx, houseId, request.id, { forUpdate: true });
      if (!locked || locked.state !== "asking" || locked.askedAt) return null;
      if (!video) {
        await repos.showcase.updateRequest(tx, locked.id, { media });
        return null;
      }
      return (await sendAsks(deps, tx, locked, video, media, now)).end;
    });
    if (end) await endShowcase(deps, request.id, "withdrawn", end);
  } catch (err) {
    deps.log.warn({ requestId, err: err instanceof Error ? err.message : String(err), code: (err as { code?: string })?.code }, "showcase: step failed (tried again by the sweep)");
  }
}

const running = new Set<Promise<unknown>>();
/** Resolves when every step queued so far has finished (tests wait for them). */
export async function settleShowcaseRuns(): Promise<void> {
  while (running.size) await Promise.allSettled([...running]);
}

/** `advanceShowcase`, not waited on, on the database itself (it outlives the request that asked for it). */
export function queueShowcaseAdvance(deps: ShowcaseDeps, requestId: string): void {
  const run = advanceShowcase({ ...deps, db: ungated(deps.db) }, requestId).finally(() => running.delete(run));
  running.add(run);
}

/**
 * After something that may withdraw a video changed in a project (its page went private, a milestone was hidden, a
 * founder joined, left or changed role): check its open request now rather than at the next sweep. Never throws and is
 * never waited on.
 */
export function queueShowcaseCheck(deps: ShowcaseDeps, subjectBusinessId: string): void {
  const db = ungated(deps.db);
  const run = repos.showcase
    .openForSubject(db, subjectBusinessId)
    .then((r) => (r ? advanceShowcase({ ...deps, db }, r.id) : undefined))
    .catch((err) => deps.log.warn({ subjectBusinessId, err: err instanceof Error ? err.message : String(err) }, "showcase: check failed"))
    .finally(() => running.delete(run));
  running.add(run);
}

/** `promise`, then a showcase check of the project (people's access changed): a founder who joined, left or changed role. */
export function afterPeopleChange<T>(ctx: ShowcaseDeps & { businessId: string }, promise: Promise<T>): Promise<T> {
  return promise.then((value) => {
    queueShowcaseCheck(ctx, ctx.businessId);
    return value;
  });
}

/** Every open request, one step each: at boot and every 10 minutes. */
export function startShowcaseSweep(deps: ShowcaseDeps, everyMs = SHOWCASE_SWEEP_MS): { stop(): Promise<void> } {
  let stopped = false;
  let current: Promise<void> | null = null;
  const run = async () => {
    try {
      for (const r of await repos.showcase.listOpen(deps.db)) {
        if (stopped) break;
        await advanceShowcase(deps, r.id);
      }
    } catch (err) {
      deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "showcase: sweep failed (tried again later)");
    }
  };
  const tick = () => {
    if (stopped || current) return;
    current = run().finally(() => {
      current = null;
    });
  };
  tick();
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await current;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The founder's side
// ---------------------------------------------------------------------------------------------------------------------

/** What one founder reads about their own ask: exactly what would be posted, and their own answer only. */
export interface ShowcaseAskView {
  consentId: string;
  requestId: string;
  preview: ShowcasePreview;
  /** Their own answer, never anyone else's. */
  answer: ShowcaseAnswer | null;
  withdrawn: boolean;
  expiresAt: Date;
  /** The ask's overall state (asking, approved, declined, withdrawn, expired). */
  state: ShowcaseRequestState;
  canAnswer: boolean;
  canWithdraw: boolean;
}

async function askView(db: Executor, consent: ShowcaseConsent, now: Date): Promise<ShowcaseAskView> {
  const request = await repos.showcase.requestById(db, consent.requestId);
  const state: ShowcaseRequestState = request?.state ?? "withdrawn";
  // Where a clip is served from today (the house refreshes the addresses); everything else is the founder's own copy.
  const fresh = request?.preview.video?.clips ?? [];
  const preview: ShowcasePreview = consent.preview.video ? { ...consent.preview, video: { clips: consent.preview.video.clips.map((c) => ({ ...c, url: fresh.find((f) => f.taskId === c.taskId)?.url ?? c.url })) } } : consent.preview;
  const open = state === "asking" && consent.expiresAt.getTime() > now.getTime();
  return {
    consentId: consent.id,
    requestId: consent.requestId,
    preview,
    answer: consent.answer,
    withdrawn: consent.withdrawnAt !== null,
    expiresAt: consent.expiresAt,
    state,
    canAnswer: open && consent.answer === null && !!request && request.previewHash === consent.previewHash,
    canWithdraw: (state === "asking" || state === "approved") && consent.answer === "yes" && consent.withdrawnAt === null,
  };
}

/** The founder's own row, read through RLS (their own row only, while they hold an owner's standing). */
async function ownConsent(ctx: BusinessContext, by: { consentId: string } | { inboxItemId: string }): Promise<ShowcaseConsent> {
  assertFounder(ctx);
  const consent = await ctx.rls((tx) => repos.showcase.consentFor(tx, ctx.businessId, ctx.userId, by));
  if (!consent) throw new NotFoundError("showcase_ask", "consentId" in by ? by.consentId : by.inboxItemId);
  return consent;
}

/** `showcase.ask`: the founder's own ask, by their note or by its id. */
export async function myAsk(ctx: BusinessContext, input: { consentId?: string | null; inboxItemId?: string | null }, deps: Pick<ShowcaseDeps, "now"> = {}): Promise<ShowcaseAskView> {
  const by = input.consentId ? { consentId: input.consentId } : input.inboxItemId ? { inboxItemId: input.inboxItemId } : null;
  if (!by) throw new NotFoundError("showcase_ask", "none");
  const consent = await ownConsent(ctx, by);
  return askView(ctx.db, consent, nowOf(deps));
}

/**
 * `showcase.answer`: the founder's yes or no, signed in, to the final video they were shown. One no declines the whole
 * ask at once; a yes approves only when every current founder said yes to the same video.
 */
export async function answerAsk(ctx: BusinessContext, input: { consentId: string; answer: ShowcaseAnswer }, deps: Pick<ShowcaseDeps, "houseId" | "now"> = {}): Promise<ShowcaseAskView> {
  const own = await ownConsent(ctx, { consentId: input.consentId });
  const now = nowOf(deps);
  const engine = engineDeps(ctx, deps);
  const end = await ctx.db.transaction(async (tx) => {
    const request = await repos.showcase.requestById(tx, own.requestId, { forUpdate: true });
    const consent = await repos.showcase.consentFor(tx, ctx.businessId, ctx.userId, { consentId: own.id }, { forUpdate: true });
    if (!request || !consent || request.state !== "asking" || !request.askedAt || consent.answer !== null || consent.expiresAt.getTime() <= now.getTime() || request.previewHash !== consent.previewHash) throw new AppError("showcase_closed", WORDS.closed, 409);
    await repos.showcase.answer(tx, consent.id, input.answer, now);
    if (consent.inboxItemId) await repos.showcase.closeNote(tx, ctx.businessId, consent.inboxItemId, "answered");
    await repos.audit.append(tx, ctx.businessId, { actorKind: "user", actorId: ctx.userId, action: "showcase.answered", target: { kind: "showcase_consent", id: consent.id }, details: {} });
    return (await settleLocked(engine, tx, request, now)).end;
  });
  if (end) await endShowcase(engine, own.requestId, end.state, end.reason);
  return askView(ctx.db, (await ctx.rls((tx) => repos.showcase.consentFor(tx, ctx.businessId, ctx.userId, { consentId: own.id })))!, now);
}

/** `showcase.withdraw`: the founder takes their yes back before the video is posted; that alone withdraws the video. */
export async function withdrawMine(ctx: BusinessContext, input: { consentId: string }, deps: Pick<ShowcaseDeps, "houseId" | "now"> = {}): Promise<ShowcaseAskView> {
  const own = await ownConsent(ctx, { consentId: input.consentId });
  const now = nowOf(deps);
  const changed = await ctx.db.transaction(async (tx) => {
    const request = await repos.showcase.requestById(tx, own.requestId, { forUpdate: true });
    if (!request || !isShowcaseOpen(request.state)) throw new AppError("showcase_closed", WORDS.closed, 409);
    const done = await repos.showcase.withdraw(tx, own.id, now);
    if (done) await repos.audit.append(tx, ctx.businessId, { actorKind: "user", actorId: ctx.userId, action: "showcase.withdrawn", target: { kind: "showcase_consent", id: own.id }, details: {} });
    return done;
  });
  if (changed) await endShowcase(engineDeps(ctx, deps), own.requestId, "withdrawn", "founder_withdrew");
  return askView(ctx.db, (await ctx.rls((tx) => repos.showcase.consentFor(tx, ctx.businessId, ctx.userId, { consentId: own.id })))!, now);
}

/** `showcase.setting.get`: "Foundmill may ask to feature this project", as the project reads it. Any member may read it. */
export async function getSetting(ctx: BusinessContext): Promise<{ mayAsk: boolean; chosen: boolean; canChange: boolean }> {
  const stored = await repos.showcase.mayAskSetting(ctx.db, ctx.businessId);
  return { mayAsk: showcaseMayAsk(stored), chosen: stored !== null, canChange: isOwnerRole(ctx.role) && !isExample(ctx) && !ctx.business.isDemo };
}

/** `showcase.setting.set` (founders): switching it off withdraws an open ask at once. */
export async function setSetting(ctx: BusinessContext, input: { mayAsk: boolean }, deps: Pick<ShowcaseDeps, "houseId" | "now"> = {}): Promise<{ mayAsk: boolean; chosen: boolean; canChange: boolean }> {
  assertFounder(ctx);
  if (ctx.business.isDemo) throw new AppError("page_sample_business", "This is a sample business, so it is never featured.", 409);
  await ctx.db.transaction(async (tx) => {
    await repos.showcase.setMayAsk(tx, ctx.businessId, input.mayAsk);
    await repos.audit.append(tx, ctx.businessId, { actorKind: "user", actorId: ctx.userId, action: "showcase.setting", target: { kind: "business", id: ctx.businessId }, details: { mayAsk: input.mayAsk } });
  });
  if (!input.mayAsk) {
    const open = await repos.showcase.openForSubject(ctx.db, ctx.businessId);
    if (open) await endShowcase(engineDeps(ctx, deps), open.id, "withdrawn", "setting_off");
  }
  return getSetting(ctx);
}

// ---------------------------------------------------------------------------------------------------------------------
// The share gate
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Whether the house may share this draft now. Null when the asset is not a showcase post. Every share of a showcase
 * post (`recordShareOpened`, the Creative tab's share panel) asks this first, and so must any connector that would
 * post it.
 */
export async function showcaseShareGate(db: Executor, houseId: string, assetId: string, now: Date): Promise<{ request: ShowcaseRequest; refusal: ShowcaseShareRefusal | null } | null> {
  const request = await repos.showcase.byAsset(db, houseId, assetId);
  if (!request) return null;
  const draft = await repos.showcase.draft(db, houseId, assetId);
  const consents = await repos.showcase.consentsOf(db, request.id);
  const owners = await repos.showcase.currentOwnerIds(db, request.subjectBusinessId);
  const refusal = showcaseShareRefusal(
    {
      state: request.state,
      approvedUntil: request.approvedUntil,
      previewHash: request.previewHash,
      draftHash: draft && draft.approvalState !== "rejected" && !draft.archivedAt ? draftHash(request.preview, draft.body ?? "") : "",
      yesUserIds: consents.filter((c) => c.answer === "yes" && !c.withdrawnAt).map((c) => c.userId),
      currentOwnerIds: owners,
      pagePublic: await repos.showcase.pagePublic(db, request.preview.slug),
      milestonesShown: await repos.showcase.milestonesShown(db, request.preview.slug, request.preview.shots.map((s) => s.milestoneId)),
      videoFinal: !!request.preview.video && request.preview.video.clips.every((c) => !!c.url) && !request.media.deletedAt && !(request.media.clips ?? []).some((c) => c.simulated),
    },
    now,
  );
  return { request, refusal };
}

/** The refusal as an error a share control shows. */
export function showcaseShareError(refusal: ShowcaseShareRefusal): AppError {
  return new AppError("showcase_share_refused", SHOWCASE_SHARE_REFUSAL_WORDS[refusal], 409);
}

/**
 * The share panel of a showcase post on the house's Creative tab: the approved words and the approved link, while the
 * gate passes; none otherwise (the post is not offered to share at all).
 */
export async function showcaseShareDraft(db: Executor, houseId: string, assetId: string, now: Date): Promise<PostDraft | null> {
  const gate = await showcaseShareGate(db, houseId, assetId, now);
  if (!gate || gate.refusal) return null;
  return { text: gate.request.preview.postText, link: gate.request.preview.link, variants: {} };
}
