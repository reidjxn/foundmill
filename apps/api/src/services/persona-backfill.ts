/**
 * Anthropomorphic agents (0067): agents hired before every hire took a persona key get one at api boot, after the
 * migrations, with the rules a hire uses (`repos.agents.backfillPersonas`: unique within the business, avoiding the
 * owner's other businesses' keys, seeded by the business id). Idempotent, so every boot of every replica may run it: an
 * agent that has a key keeps it, and the per-business persona lock stops two replicas picking for the same business at
 * once. It runs in the background and never blocks boot; a failure is logged and the next boot tries again (until then
 * an agent without a key simply shows as it always did).
 */
import { repos, type Db } from "@foundmill/db";

interface BackfillLogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
}

export type PersonaBackfillOutcome = { status: "done"; businesses: number; agents: number; failed: number } | { status: "failed"; error: string };

export async function backfillPersonasOnBoot(deps: { db: Db; log: BackfillLogger }): Promise<PersonaBackfillOutcome> {
  try {
    const result = await repos.agents.backfillPersonas(deps.db);
    for (const f of result.failed) deps.log.warn({ businessId: f.businessId, err: f.error }, "persona backfill: could not give this business's agents persona keys; the next boot tries again");
    if (result.agents > 0 || result.failed.length > 0) deps.log.info({ businesses: result.businesses, agents: result.agents, failed: result.failed.length }, "persona backfill done");
    return { status: "done", businesses: result.businesses, agents: result.agents, failed: result.failed.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    deps.log.warn({ err: error }, "persona backfill failed; serving anyway (the next boot tries again)");
    return { status: "failed", error };
  }
}
