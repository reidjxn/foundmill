/**
 * Email from Foundmill to a person (docs/THESIS_REVIEW.md packages 1.5 and 5.1): the push notifier's sibling for the
 * one channel that reaches a person outside the app. Push answers events as they are published; this answers time
 * passing, so it is a scheduled pass, run at boot and every hour like the sample roll-forward (`startNotifyEmail`), on
 * when NOTIFY_EMAIL is on (the default) and PLATFORM_MAIL_DOMAIN is set.
 *
 * Who gets an email (`decision_waiting`), all of these:
 *   - a note that needs the person's answer (it holds Continue, is a decision, or is a warning with a choice), still
 *     open, written between 7 days and 24 hours ago (`NOTIFY_WAIT_MS`, `NOTIFY_LOOKBACK_MS`);
 *   - the person has no receipt for it (they never opened it, on the web or the app);
 *   - they are a member of the business, not through an example membership, and can read the Inbox; the business is
 *     live and not a sample;
 *   - their own switch for the kind is on (Settings › Preferences; the link in every such email turns it off);
 *   - they were never emailed about this note before; they got no such email about this business today (UTC) and fewer
 *     than three today across all their businesses (`NOTIFY_PER_PROJECT_PER_DAY`, `NOTIFY_PER_PERSON_PER_DAY`).
 * The oldest waiting note of each business goes first, and the businesses in the order of their oldest note.
 *
 * The api sends ids only; the gateway (`POST /v1/notify/email`) checks all of it again with counts shared by every
 * replica, reads the address from the account, writes the words and `notify.email_sent` (keyed per person, kind and UTC
 * day in the business, the durable record this pass reads back), so two api replicas running the pass at once still
 * send one. A gateway that says platform mail is off, not configured or paused for a moment ends the pass (the next one
 * tries again); any other "not sent" moves on to the next person. Nothing here ever holds an address.
 */
import { repos, utcDayStart, type WaitingAnswer } from "@foundmill/db";
import { hasSectionAccess, NOTIFY_LOOKBACK_MS, NOTIFY_PER_PERSON_PER_DAY, NOTIFY_PER_PROJECT_PER_DAY, NOTIFY_WAIT_MS, platformMailDomain, type Env } from "@foundmill/shared";
import type { ApiDeps } from "../../context";

export const NOTIFY_EMAIL_INTERVAL_MS = 60 * 60 * 1000;
/** Pairs read in one pass (oldest first); the next pass reads the rest. */
export const NOTIFY_EMAIL_BATCH = 2_000;
/** A gateway answer that means no email can go out right now, for anyone. */
const STOP_REASONS = new Set(["off", "unconfigured", "store", "ceiling", "simulated"]);

export type NotifyEmailDeps = Pick<ApiDeps, "db" | "gateway" | "log">;

export interface NotifyPassResult {
  /** People with at least one waiting note. */
  people: number;
  sent: number;
  /** The gateway's "not sent", by reason. */
  notSent: Record<string, number>;
  failed: number;
  /** True when the gateway said nothing can go out now, and the pass stopped early. */
  stopped: boolean;
}

/** On unless NOTIFY_EMAIL is off; only where platform mail is configured. */
export const notifyEmailEnabled = (env: Pick<Env, "NOTIFY_EMAIL" | "PLATFORM_MAIL_DOMAIN">): boolean => env.NOTIFY_EMAIL !== "off" && platformMailDomain(env) !== null;

/** One pass: decide who is emailed about what, and ask the gateway, one email at a time. */
export async function runNotifyEmailPass(deps: NotifyEmailDeps, now: Date = new Date()): Promise<NotifyPassResult> {
  const result: NotifyPassResult = { people: 0, sent: 0, notSent: {}, failed: 0, stopped: false };
  const waiting = await repos.notifyEmail.waitingAnswers(deps.db, { olderThan: new Date(now.getTime() - NOTIFY_WAIT_MS), since: new Date(now.getTime() - NOTIFY_LOOKBACK_MS), limit: NOTIFY_EMAIL_BATCH });
  const byPerson = new Map<string, WaitingAnswer[]>();
  for (const w of waiting) {
    if (!hasSectionAccess(w.membership, "inbox", "read")) continue;
    const list = byPerson.get(w.userId) ?? [];
    list.push(w);
    byPerson.set(w.userId, list);
  }
  result.people = byPerson.size;
  const dayStart = utcDayStart(now);

  for (const [userId, notes] of byPerson) {
    const prefs = await repos.preferences.get(deps.db, userId);
    if (!prefs.email.decision_waiting) continue;
    const memberOf = (await repos.memberships.listForUser(deps.db, userId)).map((m) => m.businessId);
    const sentToday = await repos.notifyEmail.sentSince(deps.db, userId, memberOf, dayStart);
    let total = [...sentToday.values()].reduce((a, b) => a + b, 0);
    // The person's notes per business, each list oldest first; the businesses in the order of their oldest note.
    const perBusiness = new Map<string, WaitingAnswer[]>();
    for (const n of notes) perBusiness.set(n.businessId, [...(perBusiness.get(n.businessId) ?? []), n]);
    for (const [businessId, items] of perBusiness) {
      if (total >= NOTIFY_PER_PERSON_PER_DAY) break;
      if ((sentToday.get(businessId) ?? 0) >= NOTIFY_PER_PROJECT_PER_DAY) continue;
      const emailed = await repos.notifyEmail.emailedItems(deps.db, businessId, userId, items.map((i) => i.inboxItemId));
      const next = items.find((i) => !emailed.has(i.inboxItemId));
      if (!next) continue;
      try {
        const answer = await deps.gateway.notifyEmail({ userId, kind: "decision_waiting", businessId, data: { inboxItemId: next.inboxItemId } });
        if (answer.sent) {
          result.sent += 1;
          total += 1;
          continue;
        }
        result.notSent[answer.reason] = (result.notSent[answer.reason] ?? 0) + 1;
        if (STOP_REASONS.has(answer.reason)) {
          result.stopped = true;
          deps.log.info({ reason: answer.reason }, "notify email pass stopped: the gateway sends nothing right now");
          return result;
        }
      } catch (err) {
        result.failed += 1;
        deps.log.warn({ businessId, userId, err: (err as Error).message }, "notify email not sent");
        // The gateway is unreachable or refused the service: nothing else will go out in this pass either.
        result.stopped = true;
        return result;
      }
    }
  }
  if (result.sent > 0 || result.failed > 0) deps.log.info({ people: result.people, sent: result.sent, notSent: result.notSent, failed: result.failed }, "notify email pass");
  return result;
}

/** The pass at boot and every `intervalMs`; a pass still running when the next is due is not doubled. */
export function startNotifyEmail(deps: NotifyEmailDeps, intervalMs = NOTIFY_EMAIL_INTERVAL_MS): { stop(): Promise<void>; done: Promise<unknown> } {
  let running: Promise<unknown> | null = null;
  let stopped = false;
  const pass = () => {
    if (running || stopped) return running ?? Promise.resolve();
    running = runNotifyEmailPass(deps)
      .catch((err: unknown) => deps.log.warn({ err: (err as Error).message }, "the notify email pass failed; the next one tries again"))
      .finally(() => {
        running = null;
      });
    return running;
  };
  const done = pass();
  const timer = setInterval(() => void pass(), intervalMs);
  timer.unref?.();
  return {
    done,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
