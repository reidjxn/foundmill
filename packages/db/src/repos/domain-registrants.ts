/**
 * domain_registrants (0150): the founder's registrant details for a paid domain checkout, between paying and
 * registering. Service connection only (no app role reads or writes the table); removed once the domain is registered.
 */
import { RegistrantContact } from "@foundmill/shared";
import { and, eq } from "drizzle-orm";
import { checkoutsRepo } from "./checkouts";
import { domainRegistrants } from "../schema";
import { maybeOne, type Executor } from "./_shared";

export const domainRegistrantsRepo = {
  async put(db: Executor, businessId: string, checkoutId: string, registrant: Record<string, unknown>): Promise<void> {
    await db.insert(domainRegistrants).values({ businessId, checkoutId, registrant }).onConflictDoUpdate({ target: domainRegistrants.checkoutId, set: { registrant } });
  },

  async get(db: Executor, businessId: string, checkoutId: string): Promise<Record<string, unknown> | null> {
    return maybeOne(await db.select({ r: domainRegistrants.registrant }).from(domainRegistrants).where(and(eq(domainRegistrants.businessId, businessId), eq(domainRegistrants.checkoutId, checkoutId))).limit(1))?.r ?? null;
  },

  async remove(db: Executor, businessId: string, checkoutId: string): Promise<void> {
    await db.delete(domainRegistrants).where(and(eq(domainRegistrants.businessId, businessId), eq(domainRegistrants.checkoutId, checkoutId)));
  },
};

/** The paid domain checkouts of one connection, in the shape the registration flow takes (`DomainOrders`, @foundmill/connectors). */
export function domainOrdersStore(db: Executor) {
  return {
    async claim(businessId: string, checkoutId: string): Promise<{ domain: string; priceMinor: number; owner: RegistrantContact; simulated: boolean; createdBy: string | null } | null> {
      const checkout = await checkoutsRepo.claimDomainOrder(db, businessId, checkoutId);
      if (!checkout?.domainName) return null;
      const owner = RegistrantContact.safeParse(await domainRegistrantsRepo.get(db, businessId, checkoutId));
      if (!owner.success) {
        await checkoutsRepo.releaseDomainOrder(db, businessId, checkoutId, "the registrant details are missing");
        return null;
      }
      return { domain: checkout.domainName, priceMinor: Number(checkout.amountMinor), owner: owner.data, simulated: checkout.mode === "mock", createdBy: checkout.createdBy };
    },
    release: (businessId: string, checkoutId: string, failure: string) => checkoutsRepo.releaseDomainOrder(db, businessId, checkoutId, failure),
    note: (businessId: string, checkoutId: string, failure: string) => checkoutsRepo.noteDomainOrder(db, businessId, checkoutId, failure),
    // Registered: the founder's details are with the registry now, and no longer kept here.
    done: (businessId: string, checkoutId: string) => domainRegistrantsRepo.remove(db, businessId, checkoutId),
  };
}
