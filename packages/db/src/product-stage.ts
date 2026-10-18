/**
 * The product stage of a business (founder, 2026-10-18): derived from the foundations row, the latest sign-off rounds
 * and `businesses.distribution_started_at`, never stored. Read by `business.get`, the cycle brief and the modules.
 *
 * - `drafting`: the foundations are pending, drafting or failed.
 * - `awaiting_signoff`: the foundations are ready and the latest spec or roadmap round is not approved.
 * - `building`: both latest rounds approved (or a business from before sign-offs existed), distribution not started.
 * - `selling`: distribution has started.
 */
import type { FoundationsStatus, ProductStage } from "@foundmill/shared";
import type { Executor } from "./repos/_shared";
import { businessesRepo } from "./repos/businesses";
import { foundationsRepo } from "./repos/foundations";
import { productSignoffsRepo, type LatestSignoffs } from "./repos/product-signoffs";

export interface ProductStageFacts {
  /** `none` for a business committed before foundations existed (and the demo seeds). */
  foundationsStatus: FoundationsStatus | "none";
  signoffs: Pick<LatestSignoffs, "spec" | "roadmap">;
  distributionStartedAt: Date | null;
}

export function productStageOf(facts: ProductStageFacts): ProductStage {
  if (facts.distributionStartedAt) return "selling";
  if (facts.foundationsStatus !== "none" && facts.foundationsStatus !== "ready") return "drafting";
  // A business with no foundations row never waits for a sign-off nobody asked for (migration 0062 backfilled its rounds).
  if (facts.foundationsStatus === "none" && !facts.signoffs.spec && !facts.signoffs.roadmap) return "building";
  const approved = facts.signoffs.spec?.status === "approved" && facts.signoffs.roadmap?.status === "approved";
  return approved ? "building" : "awaiting_signoff";
}

/** Both latest rounds approved: what starts the first build. */
export function bothSignedOff(signoffs: Pick<LatestSignoffs, "spec" | "roadmap">): boolean {
  return signoffs.spec?.status === "approved" && signoffs.roadmap?.status === "approved";
}

export async function loadProductStage(db: Executor, businessId: string): Promise<{ stage: ProductStage; facts: ProductStageFacts; signoffs: LatestSignoffs }> {
  const [business, foundations, signoffs] = await Promise.all([businessesRepo.get(db, businessId, { includeArchived: true }), foundationsRepo.get(db, businessId), productSignoffsRepo.latest(db, businessId)]);
  const facts: ProductStageFacts = { foundationsStatus: foundations?.status ?? "none", signoffs, distributionStartedAt: business.distributionStartedAt };
  return { stage: productStageOf(facts), facts, signoffs };
}
