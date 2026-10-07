"use client";
/**
 * Milestones widget (BUILD §11.4; registry key `trophy_cabinet`): the eight milestone definitions from
 * `@foundmill/journey`, reached ones in gold with the date (and the customer when permission is recorded), the rest
 * ghosted. LIVE adds Share.
 */
import { useMemo } from "react";
import { z } from "zod";
import { Trophy } from "lucide-react";
import { TROPHIES, type TrophyDefinition } from "@foundmill/journey";
import { TrophyCabinet, formatMoney, type TrophyCard } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetData, useWidgetQuery } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import { routes } from "../shared/routes";
import { addDays, dayKey } from "../shared/time";
import type { RibbonResponse } from "../shared/types";

export const TrophyCabinetSettings = z.object({
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(4),
  /** Hide milestones not yet reached. */
  wonOnly: z.boolean().default(false),
});
export type TrophyCabinetSettings = z.infer<typeof TrophyCabinetSettings>;

function describe(t: TrophyDefinition, currency: string): string {
  if (t.metric === "customers") return t.threshold === 1 ? "The first paying customer." : `${t.threshold.toLocaleString("en-GB")} paying customers.`;
  if (t.metric === "mrrMinor") return `Monthly recurring revenue reaches ${formatMoney({ amountMinor: t.threshold, currency })}.`;
  return "A signed contract above the enterprise threshold.";
}

type MilestoneRow = RibbonResponse["milestones"][number];

/**
 * The milestone definition key a stored row carries. `milestones` has no trophy_key column: the seed and the
 * journey consumer keep it in `ref.trophyKey`, while older fixtures put it on the row itself; both are read.
 */
export function milestoneKey(m: Pick<MilestoneRow, "trophyKey" | "ref">): string | null {
  if (typeof m.trophyKey === "string" && m.trophyKey) return m.trophyKey;
  const ref = (m.ref ?? null) as Record<string, unknown> | null;
  return ref && typeof ref.trophyKey === "string" && ref.trophyKey ? ref.trophyKey : null;
}

/** Match stored milestones to milestone definitions by key (row or ref.trophyKey), or kind + label as a fallback. */
export function trophyCards(milestones: RibbonResponse["milestones"] | undefined, currency: string, live: boolean): TrophyCard[] {
  return TROPHIES.map((t) => {
    const label = t.label(currency);
    const rows = milestones ?? [];
    const won = rows.find((m) => milestoneKey(m) === t.key) ?? rows.find((m) => milestoneKey(m) === null && m.kind === t.kind && m.label === label);
    const ref = (won?.ref ?? {}) as Record<string, unknown>;
    const permission = ref.permission === true || ref.shareCustomer === true;
    return {
      key: t.key,
      label,
      description: describe(t, currency),
      achievedAt: won?.achievedAt ?? null,
      customerName: won && permission && typeof ref.customerName === "string" ? ref.customerName : null,
      amountMinor: typeof ref.amountMinor === "number" ? ref.amountMinor : null,
      currency,
      shareable: live && !!won && (won.visibility === "public" || won.visibility === "connections" || won.visibility === "community"),
    };
  });
}

function TrophyCabinetWidget({ settings }: WidgetProps<TrophyCabinetSettings>) {
  const { businessId, navigate, gameMode = "personal", currency = "EUR" } = useWidgetData();
  const today = dayKey();
  const ribbon = useWidgetQuery<RibbonResponse>("journey.ribbon", { from: addDays(today, -7), to: today });
  useBusinessEvents(() => ribbon.refetch(), ["customer.converted", "payment.received", "contract.signed"]);
  const cards = useMemo(() => {
    const all = trophyCards(ribbon.data?.milestones, currency, gameMode === "live");
    return settings.wonOnly ? all.filter((c) => c.achievedAt) : all;
  }, [ribbon.data, currency, gameMode, settings.wonOnly]);
  return (
    <WidgetFrame
      title="Milestones"
      data-widget="trophy_cabinet"
      queries={[ribbon]}
      empty={ribbon.data && cards.length === 0 ? { icon: Trophy, text: "The first milestone is the first paying customer. The first win starts the list." } : null}
      footer={<span>Customer names show only when permission is recorded</span>}
    >
      <TrophyCabinet trophies={cards} columns={settings.columns} onOpen={() => navigate(routes.milestones(businessId))} onShare={gameMode === "live" ? (key) => navigate(routes.milestones(businessId, key)) : undefined} />
    </WidgetFrame>
  );
}

export const trophyCabinetWidget = registerWidget<TrophyCabinetSettings>({
  key: "trophy_cabinet",
  title: "Milestones",
  description: "Customer and revenue milestones, reached and still to reach.",
  icon: "trophy",
  surfaces: ["home", "department"],
  defaultSize: { w: 6, h: 14, minW: 4, minH: 8 },
  settingsSchema: TrophyCabinetSettings,
  defaultSettings: TrophyCabinetSettings.parse({}),
  Component: TrophyCabinetWidget,
});
