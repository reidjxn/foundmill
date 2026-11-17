/**
 * `pay_links` (0131, WP-07 T7): a project's payment links.
 * - `list`, `add` and `archive` run under the caller's RLS (members read; an owner or an admin writes).
 * - `forSite` calls `site_pay_link`, the function apps/sites (`sites_reader`) may execute: never an archived or a
 *   simulated link.
 */
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { payLinks, type PayLink } from "../schema";
import { Currency, Id, maybeOne, parseInput, rowsOf, type Executor } from "./_shared";

export const AddPayLinkInput = z.object({
  key: z.string().regex(/^[a-z0-9-]{2,40}$/),
  label: z.string().trim().min(1).max(80),
  priceMinor: z.number().int().nonnegative().safe().nullish(),
  currency: Currency.nullish(),
  url: z.string().trim().max(500),
  source: z.enum(["pasted", "stripe"]).default("pasted"),
  providerLinkId: z.string().max(200).nullish(),
  simulated: z.boolean().default(false),
  createdBy: Id.nullish(),
});
export type AddPayLinkInput = z.input<typeof AddPayLinkInput>;

export const payLinksRepo = {
  /** The business's links that are not archived, oldest first. */
  async list(db: Executor, businessId: string): Promise<PayLink[]> {
    return db
      .select()
      .from(payLinks)
      .where(and(eq(payLinks.businessId, businessId), isNull(payLinks.archivedAt)))
      .orderBy(asc(payLinks.createdAt), asc(payLinks.id));
  },

  /** The link with this key, archived or not, or null. */
  async byKey(db: Executor, businessId: string, key: string): Promise<PayLink | null> {
    return maybeOne(await db.select().from(payLinks).where(and(eq(payLinks.businessId, businessId), eq(payLinks.key, key))).limit(1));
  },

  /** Adds a link. A key the business already used (an archived link's included) is a unique violation. */
  async add(db: Executor, businessId: string, input: AddPayLinkInput): Promise<PayLink> {
    const v = parseInput(AddPayLinkInput, input, "pay link");
    const [row] = await db
      .insert(payLinks)
      // Only the columns a link has: an app role may insert just a pasted link's columns (0131's column grant).
      .values({ businessId, key: v.key, label: v.label, priceMinor: v.priceMinor ?? null, currency: v.currency ?? null, url: v.url, source: v.source, createdBy: v.createdBy ?? null, ...(v.providerLinkId ? { providerLinkId: v.providerLinkId } : {}), ...(v.simulated ? { simulated: true } : {}) })
      .returning();
    return row!;
  },

  /** Every link the business ever added, archived ones included. */
  async countAll(db: Executor, businessId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(payLinks).where(eq(payLinks.businessId, businessId));
    return Number(row?.n ?? 0);
  },

  /** Archives a link: its button stops sending visitors anywhere. Null when there is no such live link. */
  async archive(db: Executor, businessId: string, id: string): Promise<PayLink | null> {
    const [row] = await db
      .update(payLinks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(payLinks.businessId, businessId), eq(payLinks.id, id), isNull(payLinks.archivedAt)))
      .returning();
    return row ?? null;
  },

  /** The URL behind `/_fm/pay/<key>` on the host whose first label is `label` (`site_pay_link`), or null. */
  async forSite(db: Executor, label: string, key: string): Promise<string | null> {
    const [row] = rowsOf<{ url: string | null }>(await db.execute(sql`select site_pay_link(${label}, ${key}) as url`));
    return row?.url ?? null;
  },
};
