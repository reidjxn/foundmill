/**
 * Default skills per role (WP-06 T6; founder, Nov 16, 2026: D3): agents hired before a release of role defaults get the
 * ones they lack at api boot, after the migrations and the persona backfill (`backfillDefaultSkills` in packages/db:
 * one business per transaction, idempotent by `agents.default_skills_version`, so it never re-adds a default a founder
 * removed). Every boot of every replica may run it. It runs in the background and never blocks boot; a failure is
 * logged per business and the next boot tries again.
 */
import { backfillDefaultSkills, type Db } from "@foundmill/db";

interface BackfillLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export type DefaultSkillsBackfillOutcome = { status: "done"; businesses: number; agents: number; attached: number; failed: number } | { status: "failed"; error: string };

export async function backfillDefaultSkillsOnBoot(deps: { db: Db; log: BackfillLogger }): Promise<DefaultSkillsBackfillOutcome> {
  try {
    const result = await backfillDefaultSkills(deps.db);
    for (const f of result.failed) deps.log.warn({ businessId: f.businessId, err: f.error }, "default skills backfill: could not give this business's agents their role's skills; the next boot tries again");
    if (result.agents > 0 || result.failed.length > 0) deps.log.info({ businesses: result.businesses, agents: result.agents, attached: result.attached, failed: result.failed.length }, "default skills backfill done");
    return { status: "done", businesses: result.businesses, agents: result.agents, attached: result.attached, failed: result.failed.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log.warn({ err: error }, "default skills backfill failed; serving anyway (the next boot tries again)");
    return { status: "failed", error };
  }
}
