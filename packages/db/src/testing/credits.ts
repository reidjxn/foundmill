/**
 * For tests of the used-up state: uses up everything a project can spend this month on Foundmill's key, the owner's
 * shared included budget (0164) and the project's own balance, as a long run of charges would.
 */
import { includedCreditsMinor } from "@foundmill/config";
import { repos } from "../repos";
import type { Executor } from "../repos/_shared";

export async function spendAllCredits(db: Executor, businessId: string, period: string): Promise<void> {
  const business = await repos.businesses.get(db, businessId, { includeArchived: true });
  const budget = includedCreditsMinor(business.planTier);
  await repos.usage.chargeCredits(db, businessId, period, 10_000_000, business.createdBy ? { owner: { userId: business.createdBy, budgetMinor: async () => budget } } : { includedMinor: budget });
}
