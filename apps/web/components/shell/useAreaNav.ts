"use client";
/**
 * The founder areas for the screen on view (docs/DESIGN.md §9): every area's tabs for this person and business, with
 * Builder view applied, and the tab bar an area's screens declare (department routes, /crm and /milestones).
 */
import { useMemo } from "react";
import type { TabBarProps } from "@foundmill/dugout";
import { AREA_LABELS, type AreaKey, type AreaTab } from "@foundmill/shared/areas";
import { useBuilderViewPreference } from "@/components/providers/guidance-context";
import { areaNav, areaTabItems } from "@/lib/areas";
import { useBusiness } from "./business-context";

/** Every area's tabs for the signed-in person (walled departments and a walled CRM left out). */
export function useAreaNav(): Map<AreaKey, AreaTab[]> {
  const { businessId, departments, access, data } = useBusiness();
  const builder = useBuilderViewPreference().on;
  return useMemo(() => areaNav({ businessId, departments, access, builder, stage: data.stageFacts }), [businessId, departments, access, builder, data.stageFacts]);
}

/** The tab bar of a fixed surface inside an area (Milestones in Plan, Contacts in Customers), or undefined without one. */
export function useAreaTabBar(area: AreaKey, activeId: string): TabBarProps | undefined {
  const { businessId } = useBusiness();
  const nav = useAreaNav();
  return useMemo(() => {
    const tabs = nav.get(area);
    if (!tabs || tabs.length < 2) return undefined;
    return { tabs: areaTabItems(businessId, tabs), activeId, "aria-label": `${AREA_LABELS[area]} tabs` };
  }, [nav, area, activeId, businessId]);
}
