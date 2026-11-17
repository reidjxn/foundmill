/**
 * The notifier (retention plan, founder 2026-11-11; one sender since 2026-11-12), run every five minutes by the
 * `founderNotifications` schedule. For each committed business (samples left out) and each person who gets its email,
 * it reads the facts (`loadNotifyFacts`, packages/db), asks the pure rules (../notify/rules.ts) which emails are due,
 * and asks the gateway for each one by ids (`POST /v1/notify/email`). The gateway is the one sender: it reads it all
 * again, checks the person's walls, pause and address, counts the limits, builds the words (one-click answer included)
 * and keeps the record on `founder_notifications`.
 *
 * A "not sent" that will not change (turned off, paused, nothing new, no address...) is recorded as skipped under the
 * same dedupe key, so the sweep stops asking; one that may (a daily limit, a busy moment) is asked again next sweep,
 * within the day's lookback. A waiting decision is not planned here: the api's notify pass asks for those. Addresses,
 * subjects and bodies never pass through here.
 */
import { Context } from "@temporalio/activity";
import { loadNotifyFacts, repos } from "@foundmill/db";
import { dueCardEmail, hasSectionAccess, LIFECYCLE_TIMING } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import { planNotifications } from "../notify/rules";
import type { ScheduleBatch, ScheduleResult } from "./types";

/**
 * Gateway answers that a later sweep could change: asked again. Every other "not sent" is recorded as skipped.
 * `simulated` is asked again (WP-04 T11): a person's project on staging or production while SendGrid is still mock is
 * never recorded as emailed, nor as skipped for good; the sweep logs one warning for it.
 */
export const RETRY_REASONS: ReadonlySet<string> = new Set(["off", "unconfigured", "present", "per_project", "per_person", "ceiling", "busy", "store", "vendor", "simulated"]);

function heartbeat(i: number): void {
  try {
    Context.current().heartbeat(i);
  } catch {
    /* outside an activity (tests) */
  }
}

function resumedAt(total: number): number {
  try {
    const d = Context.current().info.heartbeatDetails;
    return typeof d === "number" && d > 0 && d <= total ? d : 0;
  } catch {
    return 0;
  }
}

export function createNotifyActivities(deps: OrchestratorDeps) {
  return {
    /** One sweep over the batch's businesses; returns how many emails were sent (`touched`) and what failed (notes). */
    async founderNotificationsSweep(input: ScheduleBatch): Promise<ScheduleResult> {
      const now = input.at ? new Date(input.at) : deps.clock.now();
      const result: ScheduleResult = { businesses: input.businessIds.length, touched: 0, eventIds: [], notes: [] };
      let simulated = 0;
      for (let i = resumedAt(input.businessIds.length); i < input.businessIds.length; i++) {
        const businessId = input.businessIds[i]!;
        try {
          const facts = await loadNotifyFacts(deps.db, businessId, now);
          const recipients = facts ? await repos.founders.notifyRecipients(deps.db, businessId) : [];
          if (!facts || recipients.length === 0) {
            heartbeat(i + 1);
            continue;
          }
          const ids = recipients.map((r) => r.userId);
          const [prefs, seen, lifecycle] = await Promise.all([repos.emailPrefs.getMany(deps.db, ids), repos.presence.lastSeenByUser(deps.db, businessId, ids), repos.notifications.lifecycleHistory(deps.db, businessId, ids)]);
          for (const r of recipients) {
            // No Inbox, no email (the gateway checks again, with the rest of the walls).
            if (!hasSectionAccess({ role: r.role, sectionPermissions: r.sectionPermissions }, "inbox", "read")) continue;
            for (const plan of planNotifications(facts, { userId: r.userId, prefs: prefs.get(r.userId)!, lastSeenAt: seen.get(r.userId) ?? null, lifecycle: lifecycle.get(r.userId) ?? [] })) {
              if (await repos.notifications.exists(deps.db, businessId, r.userId, plan.dedupeKey)) continue;
              try {
                const answer = await deps.gateway.notifyEmail({ userId: r.userId, kind: plan.kind, businessId, data: plan.data });
                if (answer.sent) {
                  result.touched += 1;
                  if (answer.eventId) result.eventIds.push(answer.eventId);
                } else if (answer.reason === "simulated") {
                  simulated += 1;
                } else if (!RETRY_REASONS.has(answer.reason)) {
                  await repos.notifications.skip(deps.db, businessId, { userId: r.userId, kind: plan.kind, dedupeKey: plan.dedupeKey, reason: answer.reason });
                }
              } catch (err) {
                const message = (err as Error)?.message ?? String(err);
                deps.log.warn({ businessId, kind: plan.kind, err: message.slice(0, 160) }, "founder email request failed; asked again next sweep");
                result.notes.push(`${businessId}: ${plan.kind} failed`);
              }
            }
          }
        } catch (err) {
          const message = (err as Error)?.message ?? String(err);
          deps.log.warn({ task: "founder-notifications", businessId, err: message.slice(0, 160) }, "notifier failed for one business; the others continue");
          result.notes.push(`${businessId}: failed`);
        }
        heartbeat(i + 1);
      }
      if (simulated > 0) deps.log.warn({ task: "founder-notifications", simulated }, "founder emails came back simulated for real projects: SendGrid is mock here, so nothing was sent or recorded");
      return result;
    },

    /**
     * People with a kept card and no project yet (WP-04 T12): an hour after the card, then a week after, then nothing
     * (`dueCardEmail`). One gateway ask each; the gateway reads the card, the person's switch and pause, the address and
     * the counts again, and keeps the record with no business.
     */
    async cardEmailsSweep(input: { at?: string } = {}): Promise<ScheduleResult> {
      const now = input.at ? new Date(input.at) : deps.clock.now();
      const result: ScheduleResult = { businesses: 0, touched: 0, eventIds: [], notes: [] };
      const holders = await repos.notifyFacts.cardHolders(deps.db, new Date(now.getTime() - LIFECYCLE_TIMING.cardWithinMs));
      if (holders.length === 0) return result;
      const history = await repos.notifications.lifecycleHistory(deps.db, null, holders.map((h) => h.userId));
      const prefs = await repos.emailPrefs.getMany(deps.db, holders.map((h) => h.userId));
      for (const h of holders) {
        if (prefs.get(h.userId)?.emailsPausedAt) continue;
        const due = dueCardEmail(h, { lastSeenAt: null, history: history.get(h.userId) ?? [] }, now);
        if (!due) continue;
        try {
          const answer = await deps.gateway.notifyEmail({ userId: h.userId, kind: "getting_started", businessId: null, data: { ideaId: h.ideaId, stage: due.stage } });
          if (answer.sent) result.touched += 1;
          else if (!RETRY_REASONS.has(answer.reason)) await repos.notifications.skip(deps.db, null, { userId: h.userId, kind: "getting_started", dedupeKey: due.dedupeKey, reason: answer.reason });
        } catch (err) {
          deps.log.warn({ kind: "getting_started", err: ((err as Error)?.message ?? String(err)).slice(0, 160) }, "card email request failed; asked again next sweep");
          result.notes.push("card email failed");
        }
      }
      return result;
    },
  };
}
