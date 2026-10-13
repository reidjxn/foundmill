/**
 * Section walls on journey data (BUILD §11.9; audit ARB-12). Customer Updates and their conversions are the
 * Distribution section's (journey.get/list/roundup/markViewed need Distribution read). The Ribbon (journey.ribbon) is
 * Home's for everyone, so it keeps its shape for walled staff and loses what they may not read instead:
 *
 *   finance       the money in it: each day's spend and revenue read 0, conversion amounts read 0 and a Customer
 *                 Update's acquisition cost is null; money in its commentary reads "(amount hidden)".
 *   crm           customer names: a conversion's `entityName` is null and a Customer Update's entity is a stub
 *                 ("a customer"); names and mentions in its commentary read "a customer".
 *   distribution  (Ribbon only) the per-conversion list is empty; the count stays (Home's "customers won").
 *
 * `redacted` lists the walls that changed a response, so a screen can say "hidden" rather than show a figure as real.
 */
import type { Executor } from "@foundmill/db";
import { hasSectionAccess, type SectionMembership } from "@foundmill/shared";
import { loadRedactionSource, redactValue, standIn } from "./inbox-redaction";

export type JourneyWall = "finance" | "crm" | "distribution";

export interface JourneyWalls {
  finance: boolean;
  crm: boolean;
  distribution: boolean;
}

export const journeyWalls = (membership: SectionMembership): JourneyWalls => ({
  finance: !hasSectionAccess(membership, "finance", "read"),
  crm: !hasSectionAccess(membership, "crm", "read"),
  distribution: !hasSectionAccess(membership, "distribution", "read"),
});

const listed = (walls: JourneyWalls, keys: readonly JourneyWall[]): JourneyWall[] => keys.filter((k) => walls[k]);
const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A conversion row as the reader may see it (amount behind Finance, name behind the CRM). */
export function wallConversion<T extends { amountMinor: number; entityName?: string | null }>(c: T, walls: JourneyWalls): T {
  let out = c;
  if (walls.finance) out = { ...out, amountMinor: 0 };
  if (walls.crm && "entityName" in out) out = { ...out, entityName: null };
  return out;
}

/** The Ribbon as the reader may see it. */
export function wallRibbon<R extends { rows: { spendMinor: number; revenueMinor: number }[]; conversions: { amountMinor: number; entityName?: string | null }[] }>(ribbon: R, walls: JourneyWalls): R & { redacted: JourneyWall[] } {
  const rows = walls.finance ? ribbon.rows.map((r) => ({ ...r, spendMinor: 0, revenueMinor: 0 })) : ribbon.rows;
  const conversions = walls.distribution ? [] : ribbon.conversions.map((c) => wallConversion(c, walls));
  return { ...ribbon, rows, conversions, redacted: listed(walls, ["finance", "crm", "distribution"]) };
}

/** One Customer Update as a Distribution reader walled from Finance or the CRM may see it. */
export async function wallJourneyDetail<
  D extends {
    conversion: { amountMinor: number; entityId: string | null };
    entity: { id: string; kind: string; displayName: string } | null;
    commentary: unknown[];
    journey: { commentary: unknown[]; stats: { acquisitionCostMinor: number | null } };
  },
>(db: Executor, businessId: string, detail: D, walls: JourneyWalls): Promise<D & { redacted: JourneyWall[] }> {
  const redacted = listed(walls, ["finance", "crm"]);
  if (redacted.length === 0) return { ...detail, redacted };
  const source = await loadRedactionSource(db, businessId, { finance: walls.finance, crm: walls.crm }, detail.conversion.entityId ? [detail.conversion.entityId] : []);
  const opts = { ids: detail.conversion.entityId ? [detail.conversion.entityId] : [], customer: true };
  const commentary = redactValue(detail.commentary, source, opts);
  return {
    ...detail,
    conversion: walls.finance ? { ...detail.conversion, amountMinor: 0 } : detail.conversion,
    entity: walls.crm && detail.entity ? { ...detail.entity, displayName: capitalised(standIn(detail.entity.kind, true)) } : detail.entity,
    commentary,
    journey: { ...detail.journey, commentary: redactValue(detail.journey.commentary, source, opts), stats: walls.finance ? { ...detail.journey.stats, acquisitionCostMinor: null } : detail.journey.stats },
    redacted,
  };
}
