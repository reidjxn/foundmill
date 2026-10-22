/**
 * What the top bar's Switch business lists (dugout BusinessSwitcher): the open business first, from `business.get`, so
 * a rename or a new logo shows at once even while `founder.businesses.list` is stale or still loading; then the
 * founder's other businesses from that list, with their logos once loaded. An example membership (0065, "Explore an
 * example") reads "Example" rather than its role, since it is a walk around a demo, not a seat. Pure.
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
  /** The open business is an example the founder is walking around (`access.isExample`). */
  isExample?: boolean;
}

/** The word an example membership reads in place of its role ("Viewer"). */
export const EXAMPLE_ROLE_LABEL = "Example";

/** The role chip: none for owners (most rows), "Example" for an example membership, the role's word otherwise. */
export const switcherRoleLabel = (role: MembershipRole, isExample = false): string | null => (isExample ? EXAMPLE_ROLE_LABEL : role === "owner" ? null : ROLE_WORD[role]);

type SwitcherRow = Pick<FounderBusiness, "id" | "name" | "kitPrimary" | "isDemo" | "role"> & { isExample?: boolean };

export function switcherBusinesses(rows: readonly SwitcherRow[] | undefined, current: CurrentSwitcherBusiness, logos: Readonly<Record<string, string | null>>): SwitcherBusiness[] {
  // The open business is an example when the shell says so, or when the list marks its row (whichever arrives first).
  const currentIsExample = current.isExample ?? (rows ?? []).some((b) => b.id === current.id && b.isExample === true);
  const open: SwitcherBusiness = { id: current.id, name: current.name, current: true, logoSrc: current.logoSrc, primary: current.kitPrimary, roleLabel: switcherRoleLabel(current.role, currentIsExample), demo: current.isDemo };
  const others = (rows ?? []).filter((b) => b.id !== current.id).map((b): SwitcherBusiness => ({ id: b.id, name: b.name, logoSrc: logos[b.id] ?? null, primary: b.kitPrimary, roleLabel: switcherRoleLabel(b.role, b.isExample === true), demo: b.isDemo }));
  return [open, ...others];
}
