/**
 * securities + cap_table_entries — the Cap table tab (BUILD §11.8; router finance.capTable.*).
 *
 * Holders are CRM entities. `summary` folds the entries into per-class and per-holder totals with
 * fully-diluted percentages; quantities are `numeric(20,4)` in SQL and numbers here (fractional shares
 * are legal in several jurisdictions). Round modelling (SAFE conversion, pool top-ups) is a pure
 * function in the finance module; this repo only stores the issued positions it starts from.
 */
import { SECURITY_KINDS, ValidationError } from "@founder-manager/shared";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { capTableEntries, entities, securities, type CapTableEntry, type Security } from "../schema";
import { Currency, defined, Id, JsonObject, MinorAmount, numericText, one, parseInput, type Executor, patchSchema } from "./_shared";

export const CreateSecurityInput = z.object({
  class: z.string().trim().min(1).max(80),
  kind: z.enum(SECURITY_KINDS),
  terms: JsonObject.default({}),
  authorisedQuantity: z.number().int().nonnegative().nullable().optional(),
  currency: Currency.optional(),
});
export type CreateSecurityInput = z.input<typeof CreateSecurityInput>;

export const UpdateSecurityInput = patchSchema(CreateSecurityInput.omit({ kind: true }));
export type UpdateSecurityInput = z.input<typeof UpdateSecurityInput>;

export const CreateEntryInput = z.object({
  holderEntityId: Id,
  securityId: Id,
  quantity: z.number().positive(),
  priceMinor: MinorAmount.nonnegative().nullable().optional(),
  currency: Currency.optional(),
  vesting: JsonObject.nullable().optional(),
  issuedAt: z.string().date().nullable().optional(),
});
export type CreateEntryInput = z.input<typeof CreateEntryInput>;

export const UpdateEntryInput = patchSchema(CreateEntryInput.omit({ holderEntityId: true, securityId: true }));
export type UpdateEntryInput = z.input<typeof UpdateEntryInput>;

export interface CapTableEntryRow extends CapTableEntry {
  holder: { id: string; displayName: string; kind: string };
  security: { id: string; class: string; kind: (typeof SECURITY_KINDS)[number] };
}

export interface CapTableSummary {
  totalQuantity: number;
  byClass: { securityId: string; class: string; kind: (typeof SECURITY_KINDS)[number]; quantity: number; holders: number; authorisedQuantity: number | null; fullyDilutedPct: number }[];
  byHolder: { holderEntityId: string; displayName: string; quantity: number; fullyDilutedPct: number; positions: { securityId: string; class: string; quantity: number }[] }[];
}

const scopedSecurity = (businessId: string, id: string) => and(eq(securities.businessId, businessId), eq(securities.id, id));
const scopedEntry = (businessId: string, id: string) => and(eq(capTableEntries.businessId, businessId), eq(capTableEntries.id, id));
const pct = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 10000) / 100 : 0);

export const capTableRepo = {
  async listSecurities(db: Executor, businessId: string, options: { includeArchived?: boolean } = {}): Promise<Security[]> {
    return db
      .select()
      .from(securities)
      .where(and(eq(securities.businessId, businessId), options.includeArchived ? undefined : isNull(securities.archivedAt)))
      .orderBy(asc(securities.class));
  },

  async getSecurity(db: Executor, businessId: string, securityId: string): Promise<Security> {
    return one(await db.select().from(securities).where(scopedSecurity(businessId, securityId)).limit(1), "security", securityId);
  },

  async createSecurity(db: Executor, businessId: string, input: CreateSecurityInput): Promise<Security> {
    const v = parseInput(CreateSecurityInput, input, "security");
    return one(
      await db
        .insert(securities)
        .values({ businessId, class: v.class, kind: v.kind, terms: v.terms, authorisedQuantity: v.authorisedQuantity ?? null, ...(v.currency ? { currency: v.currency } : {}) })
        .returning(),
      "security",
    );
  },

  async updateSecurity(db: Executor, businessId: string, securityId: string, input: UpdateSecurityInput): Promise<Security> {
    const v = parseInput(UpdateSecurityInput, input, "security update");
    return one(await db.update(securities).set(defined(v)).where(scopedSecurity(businessId, securityId)).returning(), "security", securityId);
  },

  async archiveSecurity(db: Executor, businessId: string, securityId: string): Promise<Security> {
    return db.transaction(async (tx) => {
      const live = await tx.select({ id: capTableEntries.id }).from(capTableEntries).where(and(eq(capTableEntries.businessId, businessId), eq(capTableEntries.securityId, securityId), isNull(capTableEntries.archivedAt))).limit(1);
      if (live.length) throw new ValidationError("Security still has issued positions", { securityId });
      return one(await tx.update(securities).set({ archivedAt: new Date() }).where(scopedSecurity(businessId, securityId)).returning(), "security", securityId);
    });
  },

  // entries -----------------------------------------------------------------------------------------------------------
  async listEntries(db: Executor, businessId: string, filter: { securityId?: string; holderEntityId?: string; includeArchived?: boolean } = {}): Promise<CapTableEntryRow[]> {
    const rows = await db
      .select({
        entry: capTableEntries,
        holder: { id: entities.id, displayName: entities.displayName, kind: entities.kind },
        security: { id: securities.id, class: securities.class, kind: securities.kind },
      })
      .from(capTableEntries)
      .innerJoin(entities, eq(entities.id, capTableEntries.holderEntityId))
      .innerJoin(securities, eq(securities.id, capTableEntries.securityId))
      .where(
        and(
          eq(capTableEntries.businessId, businessId),
          filter.includeArchived ? undefined : isNull(capTableEntries.archivedAt),
          filter.securityId ? eq(capTableEntries.securityId, filter.securityId) : undefined,
          filter.holderEntityId ? eq(capTableEntries.holderEntityId, filter.holderEntityId) : undefined,
        ),
      )
      .orderBy(asc(securities.class), asc(entities.displayName), asc(capTableEntries.issuedAt));
    return rows.map((r) => ({ ...r.entry, holder: r.holder, security: r.security }));
  },

  async getEntry(db: Executor, businessId: string, entryId: string): Promise<CapTableEntry> {
    return one(await db.select().from(capTableEntries).where(scopedEntry(businessId, entryId)).limit(1), "cap table entry", entryId);
  },

  /** Issues a position. The holder must be an entity of the business and the security one of its classes. */
  async createEntry(db: Executor, businessId: string, input: CreateEntryInput): Promise<CapTableEntry> {
    const v = parseInput(CreateEntryInput, input, "cap table entry");
    return db.transaction(async (tx) => {
      const holder = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.businessId, businessId), eq(entities.id, v.holderEntityId))).limit(1);
      if (holder.length === 0) throw new ValidationError("holderEntityId is not an entity of this business", { holderEntityId: v.holderEntityId });
      const security = await capTableRepo.getSecurity(tx, businessId, v.securityId);
      if (security.authorisedQuantity !== null) {
        const issued = await tx
          .select({ q: capTableEntries.quantity })
          .from(capTableEntries)
          .where(and(eq(capTableEntries.businessId, businessId), eq(capTableEntries.securityId, v.securityId), isNull(capTableEntries.archivedAt)));
        const total = issued.reduce((n, r) => n + Number(r.q), 0) + v.quantity;
        if (total > Number(security.authorisedQuantity)) throw new ValidationError("Issuance exceeds the authorised quantity", { securityId: v.securityId, authorised: security.authorisedQuantity, wouldBe: total });
      }
      return one(
        await tx
          .insert(capTableEntries)
          .values({
            businessId,
            holderEntityId: v.holderEntityId,
            securityId: v.securityId,
            quantity: numericText(v.quantity) ?? "0",
            priceMinor: v.priceMinor ?? null,
            ...(v.currency ? { currency: v.currency } : {}),
            vesting: v.vesting ?? null,
            issuedAt: v.issuedAt ?? null,
          })
          .returning(),
        "cap table entry",
      );
    });
  },

  async updateEntry(db: Executor, businessId: string, entryId: string, input: UpdateEntryInput): Promise<CapTableEntry> {
    const v = parseInput(UpdateEntryInput, input, "cap table entry update");
    return one(
      await db
        .update(capTableEntries)
        .set(defined({ ...v, quantity: v.quantity === undefined ? undefined : (numericText(v.quantity) ?? undefined) }))
        .where(scopedEntry(businessId, entryId))
        .returning(),
      "cap table entry",
      entryId,
    );
  },

  async archiveEntry(db: Executor, businessId: string, entryId: string): Promise<CapTableEntry> {
    return one(await db.update(capTableEntries).set({ archivedAt: new Date() }).where(scopedEntry(businessId, entryId)).returning(), "cap table entry", entryId);
  },

  /** Per-class and per-holder totals with fully-diluted percentages (every live position counts, options included). */
  async summary(db: Executor, businessId: string): Promise<CapTableSummary> {
    const [entries, classes] = await Promise.all([capTableRepo.listEntries(db, businessId), capTableRepo.listSecurities(db, businessId)]);
    const totalQuantity = entries.reduce((n, e) => n + Number(e.quantity), 0);
    const byClass = classes.map((s) => {
      const mine = entries.filter((e) => e.securityId === s.id);
      const quantity = mine.reduce((n, e) => n + Number(e.quantity), 0);
      return { securityId: s.id, class: s.class, kind: s.kind, quantity, holders: new Set(mine.map((e) => e.holderEntityId)).size, authorisedQuantity: s.authorisedQuantity === null ? null : Number(s.authorisedQuantity), fullyDilutedPct: pct(quantity, totalQuantity) };
    });
    const holders = new Map<string, CapTableSummary["byHolder"][number]>();
    for (const e of entries) {
      const h = holders.get(e.holderEntityId) ?? { holderEntityId: e.holderEntityId, displayName: e.holder.displayName, quantity: 0, fullyDilutedPct: 0, positions: [] };
      h.quantity += Number(e.quantity);
      const pos = h.positions.find((p) => p.securityId === e.securityId);
      if (pos) pos.quantity += Number(e.quantity);
      else h.positions.push({ securityId: e.securityId, class: e.security.class, quantity: Number(e.quantity) });
      holders.set(e.holderEntityId, h);
    }
    const byHolder = [...holders.values()].map((h) => ({ ...h, fullyDilutedPct: pct(h.quantity, totalQuantity) })).sort((a, b) => b.quantity - a.quantity || a.displayName.localeCompare(b.displayName));
    return { totalQuantity, byClass, byHolder };
  },
};
