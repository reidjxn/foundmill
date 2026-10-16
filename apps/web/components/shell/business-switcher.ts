/**
 * What the top bar's Switch business lists (dugout BusinessSwitcher): the open business first, from `business.get`, so
 * a rename or a new logo shows at once even while `founder.businesses.list` is stale or still loading; then the
 * founder's other businesses from that list, with their logos once loaded. Pure.
 */
import type { SwitcherBusiness } from "@foundmill/dugout";
import type { MembershipRole } from "@foundmill/shared";
import { ROLE_WORD } from "@/lib/roles";
import type { RouterOutputs } from "@/lib/trpc";

export type FounderBusiness = RouterOutputs["founder"]["businesses"]["list"]["businesses"][number];

export interface CurrentSwitcherBusiness {
  id: string;
  name: string;
  kitPrimary: string;
  logoSrc: string | null;
  isDemo: boolean;
  role: MembershipRole;
}

/** The role chip: none for owners (most rows), the word otherwise. */
export const switcherRoleLabel = (role: MembershipRole): string | null => (role === "owner" ? null : ROLE_WORD[role]);

export function switcherBusinesses(rows: readonly Pick<FounderBusiness, "id" | "name" | "kitPrimary" | "isDemo" | "role">[] | undefined, current: CurrentSwitcherBusiness, logos: Readonly<Record<string, string | null>>): SwitcherBusiness[] {
  const open: SwitcherBusiness = { id: current.id, name: current.name, current: true, logoSrc: current.logoSrc, primary: current.kitPrimary, roleLabel: switcherRoleLabel(current.role), demo: current.isDemo };
  const others = (rows ?? []).filter((b) => b.id !== current.id).map((b): SwitcherBusiness => ({ id: b.id, name: b.name, logoSrc: logos[b.id] ?? null, primary: b.kitPrimary, roleLabel: switcherRoleLabel(b.role), demo: b.isDemo }));
  return [open, ...others];
}
