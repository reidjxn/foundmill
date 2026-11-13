/**
 * Posts the social agent drafts for the founder to share by tap (docs/NETWORK.md F3 "Tap-to-post", F7 "Posting";
 * docs/DESIGN.md §9e; founder, Nov 12, 2026: "a post the social channel agent wrote"). Drafting is separate from
 * running the channel: nothing here launches, schedules, publishes or measures anything.
 *
 * - **When.** `requestPostDraft` is called after the transaction that wrote the event commits, by the service that
 *   wrote it: `publishPage` when the page went live (`page.published`), `showMilestone` (`milestone.shown`), and the
 *   Board's toggle when the social channel is put on the board while the page is already live (the same draft as the
 *   first, at the moment the founder said "yes, write posts for me"). apps/ingest starts the same workflow after the
 *   `page.followed` that was the project's first. Nothing polls.
 * - **Where it runs.** The orchestrator's `postDraft` workflow (`post-draft:{businessId}:{trigger}`), always. This
 *   service adds no loop, no timer and no background work on the api's database pool: where Temporal does not answer,
 *   the draft is simply not written (logged; a missed offer, never an error). The one exception is a development or
 *   test stack (`postDraftRunsInProcess`), which has no Temporal: there the same step runs once in this process, so
 *   the local stack and the Playwright suite exercise the whole path. Staging and production never do.
 * - **What decides.** packages/db `draftTeamPost`: the existing gates (a sample business, the team-wide stop, credits,
 *   the channel's availability and its place on the board, a paused agent), one draft per trigger and the caps. A draft
 *   that is not written is not an error and is never reported to the founder.
 * - **Never in the way.** A request never throws and is never waited on: publishing a page or showing a milestone
 *   answers as it did before.
 *
 * `teamPostShares` builds what the Creative tab opens the share panel with. A share is recorded as a share that was
 * opened (`share.opened`, services/shares.ts, which also stops a waiting post from waiting); nothing says a post was
 * posted.
 */
import { POST_DRAFT_CHANNEL } from "@foundmill/agents";
import { channelAvailability } from "@foundmill/connectors";
import { draftTeamPost, repos, type Asset, type Db, type Executor, type TeamPostDraftResult, type TeamPostTriggerInput } from "@foundmill/db";
import type { ModelClient } from "@foundmill/models";
import { parseTeamPostRef, teamPostShareDraft, type Env, type PostDraft } from "@foundmill/shared";
import { channelFactsFor } from "./channel-availability";
import { writeEventRow } from "./events";
import type { ApiLogger } from "./log";
import { WORKFLOWS, workflowIds, type TemporalService } from "./temporal";

export interface PostDraftDeps {
  db: Db;
  models: ModelClient;
  temporal: TemporalService;
  env: Pick<Env, "APP_ENV" | "APP_URL" | "INTEGRATIONS_MODE" | "LIVE_CONNECTORS">;
  log: ApiLogger;
  now?: () => Date;
}

/**
 * Whether a draft may be written in this process when Temporal does not answer: only on a development or test stack,
 * which runs without Temporal. Staging and production never run a draft on the api (no background work on its
 * database pool): there the orchestrator writes it, or nobody does.
 */
export function postDraftRunsInProcess(env: Pick<Env, "APP_ENV">): boolean {
  return env.APP_ENV === "development" || env.APP_ENV === "test";
}

const inFlight = new Map<string, Promise<TeamPostDraftResult | null>>();
/** Requests that were queued and not waited on (`queuePostDraft`). */
const requests = new Set<Promise<unknown>>();

/** Resolves when every request made so far has been answered and every in-process draft has finished (tests wait for them). */
export async function settlePostDraftRuns(): Promise<void> {
  while (requests.size || inFlight.size) await Promise.allSettled([...requests, ...inFlight.values()]);
}

/** Whether the social channel is available to the business and posted by tap (`byTap`: with `by_tap`, and where simulated results are allowed). */
export async function socialPostedByTap(deps: Pick<PostDraftDeps, "db" | "env">, business: { id: string; isDemo: boolean }): Promise<boolean> {
  const availability = channelAvailability(POST_DRAFT_CHANNEL, await channelFactsFor(deps.db, { env: deps.env, businessId: business.id, business }));
  return availability.available && availability.byTap === true;
}

/**
 * One draft in this process (a development or test stack only, see `postDraftRunsInProcess`), through the same path
 * as the orchestrator's activity. Never throws: a failed call is logged by its error's name and code, and nothing was
 * stored.
 */
export async function runPostDraftLocally(deps: PostDraftDeps, businessId: string, trigger: TeamPostTriggerInput): Promise<TeamPostDraftResult | null> {
  try {
    return await draftTeamPost({ db: deps.db, models: deps.models, appUrl: deps.env.APP_URL, log: deps.log, now: deps.now }, businessId, trigger, {
      channelByTap: (business) => socialPostedByTap(deps, business),
      onWritten: (tx, { asset, ref, agentId }) =>
        writeEventRow(tx, { businessId, type: "post.drafted", actor: agentId ? { kind: "agent", id: agentId } : { kind: "system", id: "api" }, payload: { assetId: asset.id, trigger: ref.trigger, subject: ref.subject, agentId } }, `post.drafted:${asset.id}`),
    });
  } catch (err) {
    deps.log.warn({ businessId, trigger: trigger.kind, err: (err as Error)?.name, code: (err as { code?: string })?.code }, "post draft: not written");
    return null;
  }
}

/**
 * Asks for a draft after an event that calls for one: starts the orchestrator's workflow. Where Temporal does not
 * answer, nothing is drafted, except on a development or test stack, where it is written once in this process without
 * being waited on. Never throws. Returns where it went (tests read it).
 */
export async function requestPostDraft(deps: PostDraftDeps, businessId: string, trigger: TeamPostTriggerInput): Promise<"workflow" | "local" | "not_started"> {
  const workflowId = workflowIds.postDraft(businessId, trigger);
  try {
    const started = await deps.temporal.start(WORKFLOWS.postDraft, { workflowId, args: [{ businessId, trigger }] });
    if (started.queued) return "workflow";
    if (!postDraftRunsInProcess(deps.env)) {
      deps.log.info({ businessId, trigger: trigger.kind, reason: started.reason }, "post draft: the orchestrator did not answer; not drafted");
      return "not_started";
    }
    // The same trigger asked twice while its draft is being written shares the one run.
    if (!inFlight.has(workflowId)) {
      const run = runPostDraftLocally(deps, businessId, trigger).finally(() => inFlight.delete(workflowId));
      inFlight.set(workflowId, run);
    }
    return "local";
  } catch (err) {
    deps.log.warn({ businessId, trigger: trigger.kind, err: (err as Error)?.name }, "post draft: could not be requested");
    return "not_started";
  }
}

/** `requestPostDraft`, not waited on: the caller's own answer (a page published, a milestone shown) never waits for a draft. */
export function queuePostDraft(deps: PostDraftDeps, businessId: string, trigger: TeamPostTriggerInput): void {
  const request = requestPostDraft(deps, businessId, trigger).finally(() => requests.delete(request));
  requests.add(request);
}

/**
 * What the Creative tab opens the share panel with for each post the team wrote: the words, and the link and picture
 * the code attaches (the milestone's card while it is on the page, else the project's page, with the page's `via`; no
 * link while the page is down). Built from what is public anyway, so any reader of the tab may have it.
 */
export async function teamPostShares(tx: Executor, scope: { businessId: string; businessName: string; isDemo: boolean; appUrl: string }, rows: readonly Asset[]): Promise<Map<string, PostDraft>> {
  const out = new Map<string, PostDraft>();
  const posts = rows.flatMap((a) => {
    const ref = a.kind === "post" && a.body?.trim() ? parseTeamPostRef(a.contentRef) : null;
    return ref ? [{ asset: a, ref }] : [];
  });
  if (posts.length === 0) return out;
  const pageRow = scope.isDemo ? null : await repos.pages.get(tx, scope.businessId);
  const published = pageRow?.published ?? null;
  const page = pageRow && published ? { origin: scope.appUrl, slug: pageRow.slug, projectName: scope.businessName, pitch: published.pitch } : null;
  const shown = page ? await repos.teamPosts.shownMilestoneIds(tx, scope.businessId, posts.filter((p) => p.ref.trigger === "milestone_shown").map((p) => p.ref.refId)) : new Set<string>();
  for (const { asset, ref } of posts) out.set(asset.id, teamPostShareDraft({ text: asset.body ?? "", ref, page, cardShown: shown.has(ref.refId) }));
  return out;
}
