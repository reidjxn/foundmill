/**
 * What happens after an ingest call commits (BUILD §11.4 AC-11.4.1, §9.4 `journeyBuild` and `playbook`, §11.13):
 *
 * 1. A conversion that won a customer and plays a full Customer Update is narrated at once: the composer writes the
 *    red/gold `customer_won` item from its `customer.converted` event, within seconds of the payment.
 * 2. The orchestrator's `journeyBuild` (`journey:{conversionId}`) refines the first-pass journey: who was involved, the
 *    data-driven models once there are enough conversions, commentary. When the narration above failed it narrates
 *    the event itself, so a composer outage delays the note rather than losing it.
 * 3. Every enabled playbook whose trigger matches an event that was written (the source events and the
 *    `customer.converted` they produced) starts a `playbook` run (`playbook:{playbookId}:{eventId}`).
 * 4. A paid top-up that lifted a stop for used-up credits (billing.ts, `resumed`) starts again what every other way back
 *    starts (apps/api killswitch.ts `restartAfterResume`): the engines of enabled channels that had one running
 *    (`engine:{channelId}`) and the training runs left queued while the team was stopped (`training:{runId}`, a model
 *    change's retests).
 *
 * 6. A paid checkout opened to unblock the team's next round of work (`resume: 'continue'`, the pay-and-resume loop,
 *    founder Nov 17, 2026: the entry plan at the first run, a credit pack when credits ran out) starts that round by
 *    itself: the next `businessCycle` (`cycle:{businessId}:{n}`), audited as the founder's own Continue with trigger
 *    `payment`. Only when Continue would start one now: the team is not stopped, not on vacation, nothing in Needs you
 *    blocks it, no cycle is open and paid entry's plan is open. Otherwise the work waits for the founder's Continue.
 *
 * 5. The project's first confirmed follower (`/mail/confirm`, platform-mail.ts) starts `postDraft`
 *    (`post-draft:{businessId}:first_follower`): the social agent may draft a post about it for the founder to share by
 *    tap. Nothing is published or measured by it.
 *
 * None of it holds the vendor's acknowledgement: `dispatch` schedules the work and returns. Failures are logged, never
 * thrown; Temporal ids are deterministic, so a retried delivery cannot start the same work twice. `idle()` lets graceful
 * shutdown (and tests) wait for what is in flight.
 */
import { loadAutopilotFacts, nextCycleNumberOf, queuedCycleOpen, repos, type Db } from "@foundmill/db";
import type { ConversionOutcome } from "./conversions";
import type { ComposerNarrator } from "./composer-client";
import type { IngestResult } from "./ingest";
import { playbookTriggerMatches, type PlaybookTriggerEvent } from "./playbooks";
import type { IngestLogger } from "./types";
import { INGEST_WORKFLOWS, ingestWorkflowIds, type WorkflowStarter } from "./workflows";

/** Input of the orchestrator's `journeyBuild` (apps/orchestrator `JourneyBuildInput`). */
export interface JourneyBuildRequest {
  businessId: string;
  conversionId: string;
  convertedEventId: string;
  /** Narrate `convertedEventId` if it is still un-narrated when the record is refined (ingest's own narration failed). */
  narrate: boolean;
}

/** Input of the orchestrator's `playbook` workflow (apps/orchestrator `PlaybookInput`). */
export interface PlaybookRequest {
  businessId: string;
  playbookId: string;
  event: { type: string; id: string; payload: Record<string, unknown> };
}

export interface IngestFollowups {
  /** Schedules the after-commit work for what an ingest call wrote. Never throws and never waits for the work. */
  dispatch(result: IngestResult): void;
  /** A paid top-up lifted the business's credits stop: restarts its engines and queued training runs. Never throws. */
  resumed(businessId: string): void;
  /**
   * The project's first follower confirmed (`page.followed`, with "First follower" recorded in the same transaction):
   * starts the orchestrator's `postDraft`, where the social agent may draft a post about it for the founder to share by
   * tap. Whether one is written is the workflow's to decide (the channel on the board, the caps). Never throws.
   */
  firstFollower(businessId: string): void;
  /**
   * A paid checkout opened to unblock the next round of work (`resume: 'continue'`): starts it now when Continue would.
   * Called once per settlement (a duplicate or replayed event settles nothing, so it never starts twice). Never throws.
   */
  continueAfterPayment(businessId: string, checkoutId: string): void;
  /** Resolves once everything dispatched so far has settled. */
  idle(): Promise<void>;
}

export interface FollowupDeps {
  db: Db;
  /** Null when no composer is configured: journeyBuild narrates instead. */
  composer: ComposerNarrator | null;
  workflows: WorkflowStarter;
  log: IngestLogger;
}

interface WrittenEvent extends PlaybookTriggerEvent {
  id: string;
  businessId: string;
}

export function createFollowups(deps: FollowupDeps): IngestFollowups {
  const pending = new Set<Promise<void>>();

  async function customerWon(businessId: string, outcome: ConversionOutcome): Promise<void> {
    const win = outcome.win;
    if (!win) return;
    let narrated = false;
    if (win.fullMatchDay && deps.composer) {
      try {
        await deps.composer.narrate({ businessId, eventIds: [win.convertedEventId] });
        narrated = true;
      } catch (e) {
        deps.log.warn({ businessId, eventId: win.convertedEventId, err: (e as Error).message }, "customer_won narration failed; journeyBuild will narrate");
      }
    }
    const request: JourneyBuildRequest = { businessId, conversionId: outcome.conversion.id, convertedEventId: win.convertedEventId, narrate: win.fullMatchDay && !narrated };
    const started = await deps.workflows.start(INGEST_WORKFLOWS.journeyBuild, { workflowId: ingestWorkflowIds.journey(outcome.conversion.id), args: [request] });
    if (!started.started) deps.log.warn({ businessId, conversionId: outcome.conversion.id, reason: started.reason }, "journeyBuild not started; the first-pass journey stands");
  }

  async function playbooks(events: readonly WrittenEvent[]): Promise<void> {
    const byBusiness = new Map<string, WrittenEvent[]>();
    for (const e of events) byBusiness.set(e.businessId, [...(byBusiness.get(e.businessId) ?? []), e]);
    for (const [businessId, list] of byBusiness) {
      let enabled;
      try {
        enabled = await repos.playbooks.list(deps.db, businessId, { enabled: true });
      } catch (e) {
        deps.log.warn({ businessId, err: (e as Error).message }, "playbooks could not be listed");
        continue;
      }
      for (const playbook of enabled) {
        const trigger = (playbook.compiled as { trigger?: Record<string, unknown> } | null)?.trigger ?? null;
        for (const event of list) {
          if (!playbookTriggerMatches(trigger, event)) continue;
          const request: PlaybookRequest = { businessId, playbookId: playbook.id, event: { type: event.type, id: event.id, payload: event.payload } };
          const started = await deps.workflows.start(INGEST_WORKFLOWS.playbook, { workflowId: ingestWorkflowIds.playbook(playbook.id, event.id), args: [request] });
          if (started.started) deps.log.info({ businessId, playbookId: playbook.id, eventId: event.id, type: event.type }, "playbook started");
          else deps.log.warn({ businessId, playbookId: playbook.id, eventId: event.id, reason: started.reason }, "playbook not started");
        }
      }
    }
  }

  async function run(result: IngestResult): Promise<void> {
    const written = result.events.filter((e) => e.written);
    const events: WrittenEvent[] = [];
    for (const e of written) {
      events.push({ id: e.id, businessId: e.businessId, type: e.type, payload: e.payload });
      const win = e.conversion?.win;
      if (win) events.push({ id: win.convertedEventId, businessId: e.businessId, type: "customer.converted", payload: win.convertedPayload });
    }
    await Promise.all([
      ...written.filter((e) => e.conversion?.win).map((e) => customerWon(e.businessId, e.conversion!)),
      playbooks(events),
    ]);
  }

  /**
   * The same restarts as apps/api's `restartAfterResume` after Resume agents, a new key or a mock top-up: without them a
   * paid top-up left the engines the credits stop ended off and a model change's retest queued for good. A workflow
   * that is already running counts as started; one that finds the team stopped again ends at its first step.
   */
  async function restartAfterResume(businessId: string): Promise<void> {
    const [channels, queued] = await Promise.all([repos.channels.list(deps.db, businessId, { enabled: true }), repos.training.list(deps.db, businessId, { status: "queued", limit: 100 })]);
    const engines = channels.filter((c) => c.engineWorkflowId).map((c) => deps.workflows.start(INGEST_WORKFLOWS.channelEngine, { workflowId: ingestWorkflowIds.engine(c.id), args: [{ businessId, channelId: c.id, channelKey: c.channelKey }] }));
    const training = queued.items.map((run) => deps.workflows.start(INGEST_WORKFLOWS.trainingRun, { workflowId: ingestWorkflowIds.training(run.id), args: [{ businessId, trainingRunId: run.id }] }));
    const results = await Promise.all([...engines, ...training]);
    const missed = results.filter((r) => !r.started);
    if (missed.length > 0) deps.log.warn({ businessId, missed: missed.map((r) => ({ workflowId: r.workflowId, reason: r.reason })) }, "not every workflow restarted after the top-up");
    else if (results.length > 0) deps.log.info({ businessId, engines: engines.length, training: training.length }, "engines and queued training restarted after the top-up");
  }

  async function continueAfterPaid(businessId: string, checkoutId: string): Promise<void> {
    const business = await repos.businesses.get(deps.db, businessId, { includeArchived: true });
    const now = new Date();
    const [facts, queued] = await Promise.all([loadAutopilotFacts(deps.db, business, now), queuedCycleOpen(deps.db, businessId, now)]);
    const why = facts.archived ? "archived" : facts.stopReason ? "stopped" : facts.vacation ? "vacation" : facts.blockingItems > 0 ? "needs_you" : facts.cycleOpen || queued ? "cycle_open" : null;
    if (why) {
      deps.log.info({ businessId, checkoutId, why }, "paid; the next round waits for Continue");
      return;
    }
    const cycleNumber = await nextCycleNumberOf(deps.db, businessId);
    const workflowId = ingestWorkflowIds.cycle(businessId, cycleNumber);
    const started = await deps.workflows.start(INGEST_WORKFLOWS.businessCycle, { workflowId, args: [{ businessId, cycleNumber, trigger: "continue" }] });
    if (!started.started) {
      deps.log.warn({ businessId, checkoutId, reason: started.reason }, "paid; the next round could not start, Continue starts it");
      return;
    }
    // The cycle's first mark, as the api writes for a press of Continue: status reads it as queued until it starts.
    await repos.audit.append(deps.db, businessId, { actorKind: "system", actorId: null, action: "business.continue", target: { kind: "cycle", id: workflowId }, details: { cycleNumber, mode: "temporal", workflowId, trigger: "payment", checkoutId } });
    deps.log.info({ businessId, checkoutId, cycleNumber }, "paid; the next round of work started");
  }

  async function firstFollowerPost(businessId: string): Promise<void> {
    const started = await deps.workflows.start(INGEST_WORKFLOWS.postDraft, { workflowId: ingestWorkflowIds.postDraft(businessId, "first_follower"), args: [{ businessId, trigger: { kind: "first_follower" } }] });
    if (!started.started) deps.log.info({ businessId, reason: started.reason }, "postDraft not started after the first follower; no post is drafted for it");
  }

  const track = (work: Promise<void>, what: string) => {
    const p: Promise<void> = work
      .catch((e: unknown) => deps.log.error({ err: (e as Error).message }, `${what} failed`))
      .finally(() => {
        pending.delete(p);
      });
    pending.add(p);
  };

  return {
    dispatch(result) {
      if (!result.events.some((e) => e.written)) return;
      track(run(result), "ingest follow-ups");
    },
    resumed(businessId) {
      track(restartAfterResume(businessId), "restart after the top-up");
    },
    continueAfterPayment(businessId, checkoutId) {
      track(continueAfterPaid(businessId, checkoutId), "continue after the payment");
    },
    firstFollower(businessId) {
      track(firstFollowerPost(businessId), "post draft after the first follower");
    },
    async idle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
  };
}

/** Does nothing (tools and tests that do not exercise follow-ups). */
export const noFollowups: IngestFollowups = { dispatch() {}, resumed() {}, continueAfterPayment() {}, firstFollower() {}, async idle() {} };
