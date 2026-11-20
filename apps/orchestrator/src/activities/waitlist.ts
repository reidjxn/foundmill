/**
 * The waitlist's sweep (WP-03 T2; schedule `waitlist-admissions`, every 15 minutes). Two steps:
 *   (a) admit the open batches' places, then today's number. A batch (0145; WP-14 T15; the operator's row in
 *       `waitlist_batches`) is open from its UTC day until its places are taken: each sweep admits into it, in the
 *       waitlist's order, as many as it has left, so someone who joins while places remain is let in by the next sweep.
 *       A batch's admissions count in the day's `waitlist` admissions, so they come off today's number too; the number
 *       alone (no batch) works as before. In one transaction, under open sign-up's advisory lock (`repos.admissions.lockOpenCount`,
 *       the same lock apps/api counts under): room = WAITLIST_ADMIT_PER_DAY less the new `waitlist` admissions since the
 *       start of the UTC day (the sweep's and the operator's alike); under SIGNUP_OPEN also at most what is left of
 *       SIGNUP_DAILY_CEILING, which counts them too. SIGNUP_OPEN and SIGNUP_DAILY_CEILING are read here, so they carry
 *       the api's values (`waitlistEnvWarning` at boot). The next sign-ups with an account (`WAITLIST_ORDER`) are admitted as `waitlist`
 *       (`repos.waitlist.admitNext`; an account already in is closed as told and takes no place), and
 *       the funnel's `account.admitted` (WP-02 T9's event, the same idempotency key the profile step uses, so it is
 *       written once per account) is written for each new admission in the same transaction. Unset means 0: nobody.
 *   (b) email everyone admitted in the last 7 days who was not told yet (the operator's admissions too), through the
 *       gateway (`waitlist_admitted`). Sent, or refused for a reason that will not change, sets `notified_at`; a
 *       refusal that may pass (off, not set up, the day's limits, a simulated send outside development and test, the
 *       store or the vendor) leaves it null and the next sweep asks again.
 * The api lets an admitted account in on its next request (`decideAdmission` step 3); nothing here clears a refusal.
 */
import { repos } from "@foundmill/db";
import { writeAccountEvent } from "@foundmill/events";
import { signupMode } from "@foundmill/shared";
import type { OrchestratorDeps } from "../deps";
import type { ScheduleResult } from "./types";
import { RETRY_REASONS } from "./notify";

/** How far back an admission is still emailed. */
export const WAITLIST_NOTIFY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many emails a sweep. */
export const WAITLIST_NOTIFY_BATCH = 50;
/**
 * The refusals the next sweep asks again for: the founder notifier's (RETRY_REASONS), the day's cap per address, and a
 * simulated send refused outside development and test (so a mock gateway on staging never marks anyone told).
 */
export const WAITLIST_RETRY_REASONS: ReadonlySet<string> = new Set([...RETRY_REASONS, "per_address", "simulated"]);

/**
 * The boot warning (security review of WP-03 T2, M2): the sweep reads SIGNUP_OPEN and SIGNUP_DAILY_CEILING from the
 * orchestrator's own env, so with the waitlist admitting by number and SIGNUP_OPEN not on here, a deployment whose api
 * has opened sign-up would admit outside the api's ceiling. Null when there is nothing to say.
 */
export function waitlistEnvWarning(env: { WAITLIST_ADMIT_PER_DAY?: number; SIGNUP_OPEN?: string; SIGNUP_ALLOWLIST?: string }): string | null {
  if ((env.WAITLIST_ADMIT_PER_DAY ?? 0) <= 0 || signupMode(env) === "open") return null;
  return "WAITLIST_ADMIT_PER_DAY is set but SIGNUP_OPEN is not on the orchestrator: the waitlist sweep admits without SIGNUP_DAILY_CEILING. If the api has SIGNUP_OPEN on, set SIGNUP_OPEN and SIGNUP_DAILY_CEILING here to the api's values (docs/DEPLOY.md §4).";
}

/** The start of the UTC day `at` falls in (the one line of apps/api services/access.ts `utcDayStart`). */
const utcDayStart = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

export function createWaitlistActivities(deps: OrchestratorDeps) {
  return {
    async waitlistSweep(input: { at?: string } = {}): Promise<ScheduleResult> {
      const now = input.at ? new Date(input.at) : deps.clock.now();
      const since = utcDayStart(now);
      const perDay = deps.env.WAITLIST_ADMIT_PER_DAY ?? 0;
      const result: ScheduleResult = { businesses: 0, touched: 0, eventIds: [], notes: [] };

      // (a) The open batches, then today's number: one transaction, one lock, one ceiling.
      const admitted = await deps.db.transaction(async (tx) => {
        await repos.admissions.lockOpenCount(tx);
        const batches = await repos.waitlist.batchesWithPlaces(tx, { day: since.toISOString().slice(0, 10), openOnly: true });
        if (perDay <= 0 && batches.length === 0) return [];
        let ceilingRoom = signupMode(deps.env) === "open" ? (deps.env.SIGNUP_DAILY_CEILING ?? 200) - (await repos.admissions.openSince(tx, since)) : Number.POSITIVE_INFINITY;
        const rows: Awaited<ReturnType<typeof repos.waitlist.admitNext>> = [];
        const admit = async (limit: number, batchId: string | null) => {
          if (limit <= 0) return;
          const took = await repos.waitlist.admitNext(tx, { limit, now, batchId });
          ceilingRoom -= took.filter((row) => row.newAdmission).length;
          rows.push(...took);
        };
        // The same caution as `waitlistEnvWarning`, for a batch: without SIGNUP_OPEN here nothing bounds it but its places.
        if (batches.length > 0 && signupMode(deps.env) !== "open") deps.log.warn({ batches: batches.map((b) => b.number), places: batches.reduce((sum, b) => sum + b.placesLeft, 0) }, "waitlist batch open and SIGNUP_OPEN is not on the orchestrator: the batch admits without SIGNUP_DAILY_CEILING. If the api has SIGNUP_OPEN on, set SIGNUP_OPEN and SIGNUP_DAILY_CEILING here to the api's values (docs/DEPLOY.md §4)");
        for (const batch of batches) await admit(Math.min(batch.placesLeft, ceilingRoom), batch.id);
        if (perDay > 0) await admit(Math.min(perDay - (await repos.waitlist.admittedSince(tx, since)), ceilingRoom), null);
        for (const row of rows) {
          if (!row.newAdmission || !row.userId) continue;
          const eventId = await writeAccountEvent(tx as unknown as Parameters<typeof writeAccountEvent>[0], { userId: row.userId, type: "account.admitted", actor: { kind: "system", id: "waitlist" }, payload: { how: "waitlist" }, idempotencyKey: "account.admitted" });
          if (eventId) result.eventIds.push(eventId);
        }
        return rows;
      });
      const admittedCount = admitted.length;
      if (admittedCount) result.notes.push(`${admittedCount} admitted from the waitlist`);
      result.touched += admittedCount;

      // (b) The email, for everyone admitted and not told.
      const due = await repos.waitlist.toNotify(deps.db, { since: new Date(now.getTime() - WAITLIST_NOTIFY_LOOKBACK_MS), limit: WAITLIST_NOTIFY_BATCH });
      let told = 0;
      for (const entry of due) {
        try {
          const answer = await deps.gateway.accountEmail({ kind: "waitlist_admitted", userId: entry.userId, data: { waitlistEntryId: entry.id } });
          if (answer.sent || !WAITLIST_RETRY_REASONS.has(answer.reason)) {
            await repos.waitlist.markNotified(deps.db, entry.id, now);
            if (answer.sent) told++;
          }
        } catch (err) {
          const message = (err as Error)?.message ?? String(err);
          deps.log.warn({ rowId: entry.id, err: message.slice(0, 160) }, "waitlist email request failed; asked again next sweep");
        }
      }
      if (told) result.notes.push(`${told} told their place is open`);
      result.touched += told;
      deps.log.info({ platformReport: "waitlist", admitted: admittedCount, emailed: told, due: due.length }, "waitlist sweep");
      return result;
    },
  };
}
