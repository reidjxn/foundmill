/**
 * Customer Updates shared as cards (0136; WP-14 T9). The table is written on the service connection only, by the api
 * after its checks (apps/api services/update-cards.ts); members read it through RLS. `public.byId` reads the view on
 * the service connection: the signed-out card.
 */
import { and, eq } from "drizzle-orm";
import type { Executor } from "./_shared";
import { customerUpdateCards, publicCustomerUpdateCards, type CustomerUpdateCard, type PublicCustomerUpdateCard } from "../schema";

export interface CreateUpdateCardInput {
  journeyId: string;
  headline: CustomerUpdateCard["headline"];
  occurredOn: string;
  leadChannelKey: string | null;
  standoutAgent: string | null;
  note: string | null;
  verified: boolean;
  createdBy: string;
}

export const updateCardsRepo = {
  /** The card of one Customer Update, or null while it is not shared. */
  async forJourney(db: Executor, businessId: string, journeyId: string): Promise<CustomerUpdateCard | null> {
    const rows = await db.select().from(customerUpdateCards).where(and(eq(customerUpdateCards.businessId, businessId), eq(customerUpdateCards.journeyId, journeyId))).limit(1);
    return rows[0] ?? null;
  },

  /** Shares a Customer Update: the new card, or null when it already has one (a second tab changes nothing twice). Service connection. */
  async create(db: Executor, businessId: string, input: CreateUpdateCardInput): Promise<CustomerUpdateCard | null> {
    const rows = await db.insert(customerUpdateCards).values({ businessId, ...input }).onConflictDoNothing({ target: customerUpdateCards.journeyId }).returning();
    return rows[0] ?? null;
  },

  /** Stops sharing: the deleted card, or null when there was none. Service connection. */
  async remove(db: Executor, businessId: string, journeyId: string): Promise<CustomerUpdateCard | null> {
    const rows = await db.delete(customerUpdateCards).where(and(eq(customerUpdateCards.businessId, businessId), eq(customerUpdateCards.journeyId, journeyId))).returning();
    return rows[0] ?? null;
  },

  public: {
    /** One shared card as anyone may read it, or null (not shared, or its project's page is not public). Service connection. */
    async byId(db: Executor, id: string): Promise<PublicCustomerUpdateCard | null> {
      const rows = await db.select().from(publicCustomerUpdateCards).where(eq(publicCustomerUpdateCards.id, id)).limit(1);
      return rows[0] ?? null;
    },
  },
};
