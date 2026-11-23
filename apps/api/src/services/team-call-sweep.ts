/**
 * A team call always ends (founder, Nov 23, 2026: four test calls stayed "In progress" for good, none written up).
 * Every minute the sweep ends each call left open: live with no turn for `TEAM_CALL_LIMITS.idleEndMs` (15 minutes), or
 * a wrap-up whose request was lost. It ends it as the person who started the call, through the same `teamCall.end` they
 * would press (membership, the Team section wall, the plan and model allowances, the wrap-up's filing under their
 * permissions), with `via: "idle"` in the audit entry. When that person can no longer end it (they left the project, or a
 * gate refuses), the call is marked `wrap_up_failed`: over, every turn kept, and Try again writes it up.
 */
import { repos } from "@foundmill/db";
import { TEAM_CALL_LIMITS } from "@foundmill/shared";
import type { ApiDeps } from "../context";
import { createCaller } from "../router";

/** How often the sweep looks. */
export const TEAM_CALL_SWEEP_MS = 60_000;

export async function sweepIdleTeamCalls(deps: ApiDeps, now = new Date()): Promise<{ ended: number; failed: number }> {
  let ended = 0;
  let failed = 0;
  for (const call of await repos.teamCalls.idle(deps.db, { idleMs: TEAM_CALL_LIMITS.idleEndMs, now })) {
    try {
      if (!call.startedBy) throw new Error("the call has no starter any more");
      const email = await repos.founders.emailOf(deps.db, call.startedBy);
      const view = await createCaller(deps, { userId: call.startedBy, email }).teamCall.end({ businessId: call.businessId, callId: call.id, via: "idle" });
      if (view.status === "ended") ended += 1;
      else failed += 1;
    } catch (err) {
      deps.log.warn({ err: err instanceof Error ? err.message : String(err), callId: call.id }, "team call sweep: could not end the call as its starter; marking it for Try again");
      await repos.teamCalls.markWrapUpFailed(deps.db, call.businessId, call.id).catch(() => undefined);
      failed += 1;
    }
  }
  return { ended, failed };
}

export function startTeamCallSweep(deps: ApiDeps, everyMs = TEAM_CALL_SWEEP_MS): { stop(): Promise<void> } {
  let stopped = false;
  let current: Promise<void> | null = null;
  const tick = () => {
    if (stopped || current) return;
    current = sweepIdleTeamCalls(deps)
      .then(() => undefined)
      .catch((err: unknown) => deps.log.warn({ err: err instanceof Error ? err.message : String(err) }, "team call sweep failed (tried again in a minute)"))
      .finally(() => {
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
