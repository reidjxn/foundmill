/**
 * One post drafted by the social agent for the founder to share by tap (docs/NETWORK.md F3, F7; packages/agents
 * `post-draft.ts`): the one path both runners take, apps/orchestrator's `draftSharePost` activity and apps/api's
 * in-process run when Temporal does not answer.
 *
 * 1. Read what the draft is decided from (`repos.teamPosts.sources`) and ask the existing gates: not a sample business,
 *    agents not stopped, credits left on the key that pays, the social channel available by tap (the caller answers
 *    that with packages/connectors' rule) and on the Channel Board, its agent not paused, the page published, nothing
 *    drafted for this trigger yet, nothing about the same thing still waiting, and the caps.
 * 2. Build the facts: the project's name, the published page's four public fields, the one thing that happened and
 *    the link the code attaches. Nothing else is read here, so nothing else can reach the model.
 * 3. Run the step (one call, one retry with the reason): the draft is stored with its event in one transaction, or the
 *    attempt is dropped with a reason code.
 *
 * Drafting only: nothing here launches, schedules, publishes or measures. A skip is not an error and nothing is said to
 * the founder about it.
 */
import { POST_DRAFT_ROUTE, postDraftDecision, postDraftFacts, runPostDraftStep, type PostDraftRefusal, type PostDraftSkip, type PostDraftStore, type PostDraftUsage } from "@foundmill/agents";
import type { ModelClient } from "@foundmill/models";
import { TEAM_POST_CAPS, TEAM_POST_CODE_FOR_LENGTH, TEAM_POST_WEEK_MS, teamPostShareDraft, type TeamPostRef } from "@foundmill/shared";
import { checkPlatformCredits } from "./billing";
import type { Db } from "./client";
import { repos } from "./repos";
import type { Executor } from "./repos/_shared";
import type { TeamPostTriggerInput } from "./repos/team-posts";
import type { Asset } from "./schema";

export interface TeamPostDraftDeps {
  db: Db;
  models: Pick<ModelClient, "complete" | "mode">;
  /** The web app's own origin (APP_URL): the link the post carries. */
  appUrl: string;
  log?: { info(obj: Record<string, unknown>, msg?: string): void; warn(obj: Record<string, unknown>, msg?: string): void };
  now?: () => Date;
}

export interface TeamPostDraftOptions {
  /**
   * Whether the social channel is available to this business and posted by tap (packages/connectors
   * `channelAvailability("social", …).byTap`). Asked only for a business that passed the gates before it.
   */
  channelByTap: (business: { id: string; isDemo: boolean }) => Promise<boolean>;
  /** The draft's event (`post.drafted`), written through the outbox in the transaction that stores the draft. */
  onWritten: (tx: Executor, written: { asset: Asset; ref: TeamPostRef; agentId: string | null }) => Promise<unknown>;
  signal?: AbortSignal;
  caps?: { perDay: number; perWeek: number };
}

/** Why nothing was drafted: one of the rules, or there was nothing real to write about, or no credits to write with. */
export type TeamPostDraftSkip = PostDraftSkip | "no_business" | "nothing_to_say" | "no_credits";

export type TeamPostDraftResult =
  | { outcome: "written"; assetId: string; usage: PostDraftUsage }
  | { outcome: "skipped"; reason: TeamPostDraftSkip }
  | { outcome: "dropped"; reason: PostDraftRefusal; usage: PostDraftUsage };

export async function draftTeamPost(deps: TeamPostDraftDeps, businessId: string, trigger: TeamPostTriggerInput, options: TeamPostDraftOptions): Promise<TeamPostDraftResult> {
  const now = (deps.now ?? (() => new Date()))();
  const caps = options.caps ?? TEAM_POST_CAPS;
  const skipped = (reason: TeamPostDraftSkip): TeamPostDraftResult => {
    deps.log?.info({ businessId, trigger: trigger.kind, reason }, "post draft: not drafted");
    return { outcome: "skipped", reason };
  };
  const src = await repos.teamPosts.sources(deps.db, businessId, trigger, now);
  if (!src) return skipped("no_business");
  // The cheap rules first: the availability read and the credits read happen only for a business that passed them.
  const gates = {
    isDemo: src.business.isDemo,
    agentsStopped: src.business.stopped,
    channelByTap: true,
    channelOnBoard: src.channel?.enabled === true,
    agentPaused: src.agent?.paused === true,
    pageLive: src.page !== null,
    alreadyForTrigger: src.alreadyForTrigger,
    waitingForSubject: src.waitingForSubject,
    inLastDay: src.inLastDay,
    inLastWeek: src.inLastWeek,
  };
  const early = postDraftDecision(gates, caps);
  if (!early.draft) return skipped(early.reason);
  const { ref, page } = src;
  if (!ref || !page) return skipped("nothing_to_say");
  if (!(await options.channelByTap({ id: src.business.id, isDemo: src.business.isDemo }))) return skipped("not_by_tap");
  const credits = await checkPlatformCredits(deps.db, businessId, { live: deps.models.mode === "live", now });
  if (!credits.ok && credits.modelBilling !== "byok") return skipped("no_credits");

  const agentId = src.agent?.id ?? null;
  // The link the post will carry, with a code of the right length: its own codes are minted with the words (0106).
  const sizing = { link: TEAM_POST_CODE_FOR_LENGTH, networks: {} };
  const link = teamPostShareDraft({ text: "", ref, page: { origin: deps.appUrl, slug: page.slug, projectName: src.business.name, pitch: page.pitch }, cardShown: src.cardShown, codes: sizing }).link;
  // What the project's earlier posts led to in the last 7 days, counted: data for the agent, never words for the post
  // (the check refuses any figure the facts do not give, and these lines are not among the facts it reads).
  const learned = await repos.postAttributions.weekSummary(deps.db, businessId, { since: new Date(now.getTime() - TEAM_POST_WEEK_MS), until: now, week: null });
  const facts = postDraftFacts({ businessName: src.business.name, page, trigger: ref.trigger, subject: ref.subject, at: src.at ?? now, timeZone: src.business.timeZone, link, learned });
  const model = (usage: PostDraftUsage) => ({ route: POST_DRAFT_ROUTE, model: usage.model, mode: usage.mode, calls: usage.calls, costMinor: usage.costMinor, costLabel: "Estimate" });
  const store: PostDraftStore = {
    async write({ text, usage }) {
      const out = await repos.teamPosts.write(deps.db, businessId, { ref, text, authoredByAgentId: agentId, model: model(usage), now, caps, onWritten: (tx, asset) => options.onWritten(tx, { asset, ref, agentId }) });
      return { written: out.written, assetId: out.asset?.id ?? null };
    },
    async drop({ reason, usage }) {
      await repos.teamPosts.drop(deps.db, businessId, { ref, reason, authoredByAgentId: agentId, model: model(usage), now });
    },
  };
  const result = await runPostDraftStep({ models: deps.models, facts, link, signal: options.signal, scope: `post-draft:${businessId}`, attribution: { businessId, ...(agentId ? { agentId } : {}) }, log: deps.log }, store);
  if (result.outcome === "written") {
    deps.log?.info({ businessId, trigger: trigger.kind, assetId: result.assetId, calls: result.usage.calls }, "post draft: written");
    return { outcome: "written", assetId: result.assetId, usage: result.usage };
  }
  if (result.outcome === "exists") return skipped("already_drafted");
  deps.log?.warn({ businessId, trigger: trigger.kind, reason: result.reason, calls: result.usage.calls }, "post draft: dropped");
  return { outcome: "dropped", reason: result.reason, usage: result.usage };
}
