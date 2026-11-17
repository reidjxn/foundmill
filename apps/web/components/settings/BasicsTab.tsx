"use client";
/**
 * Settings › Basics (WP-10 T11; s1 §3.13, A2-04): the five settings a first-timer looks for, each one press from here,
 * each with its value now. Nothing moves: every row links to the tab that holds the setting. People never prompts to
 * add someone: a project with one person is complete (CLAUDE.md "Solo is complete").
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Icon, ProvenanceChip, ShellLink } from "@foundmill/dugout";
import { CREDITS_CURRENCY, LIMITS } from "@foundmill/config";
import { teamCanDoWords } from "@foundmill/shared/team-can-do";
import { routes } from "@foundmill/widgets/shared/routes";
import { formatMoney } from "@/lib/format";
import { useTRPC } from "@/lib/trpc-react";
import { useBusiness, useBusinessCurrency } from "@/components/shell/business-context";
import { useGuidancePreferences } from "@/components/providers/guidance-context";
import type { SettingsTabSlug } from "@/lib/search";
import { SettingsSection } from "./shared";

export interface BasicsRow {
  slug: SettingsTabSlug;
  label: string;
  /** The setting's value now, or null while it loads. */
  value: string | null;
  /** The value is an Estimate (credits). */
  estimate?: boolean;
}

export interface BasicsInput {
  name: string;
  teamCanDo: string;
  textSize: "standard" | "comfortable";
  guidance: "on" | "off";
  credits: { balance: string; granted: string } | null;
  people: number | null;
}

/** The five rows, in the order a first-timer asks for them. */
export function basicsRows(i: BasicsInput): BasicsRow[] {
  return [
    { slug: "business", label: "Name and logo", value: i.name },
    { slug: "mode", label: "How much your team asks before acting", value: i.teamCanDo },
    { slug: "preferences", label: "Text size and explanations", value: `${i.textSize === "comfortable" ? "Comfortable text" : "Standard text"} · explanations ${i.guidance}` },
    { slug: "billing", label: "Credits and spending", value: i.credits ? `${i.credits.balance} of ${i.credits.granted} left this month` : null, estimate: true },
    { slug: "members", label: "People", value: i.people === null ? null : i.people <= 1 ? "Just you" : `${i.people} people` },
  ];
}

export function BasicsList({ businessId, rows }: { businessId: string; rows: readonly BasicsRow[] }) {
  return (
    <ul className="flex flex-col" data-testid="settings-basics">
      {rows.map((r) => (
        <li key={r.slug} className="border-b border-line-faint last:border-b-0">
          <ShellLink href={routes.settings(businessId, r.slug)} className="flex min-h-control-lg items-center gap-3 py-2 text-primary hover:no-underline focus-ring rounded-sm" data-basics-row={r.slug}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="t-body-strong">{r.label}</span>
              <span className="text-small text-secondary" data-basics-value="">
                {r.value ?? "…"}
                {r.estimate && r.value ? (
                  <>
                    {" "}
                    <ProvenanceChip kind="estimate" />
                  </>
                ) : null}
              </span>
            </span>
            <Icon icon={ArrowRight} size="default" className="text-tertiary" />
          </ShellLink>
        </li>
      ))}
    </ul>
  );
}

export function BasicsTab() {
  const { businessId, data } = useBusiness();
  const currency = useBusinessCurrency();
  const trpc = useTRPC();
  const { prefs } = useGuidancePreferences();
  const plan = useQuery(trpc.billing.plan.queryOptions({ businessId }));
  const people = useQuery(trpc.team.humans.list.queryOptions({ businessId }));
  const business = data.business;
  const creditsCurrency = plan.data?.creditsCurrency ?? CREDITS_CURRENCY;
  const money = (amountMinor: number) => formatMoney({ amountMinor, currency: creditsCurrency });
  const rows = basicsRows({
    name: business.name,
    teamCanDo: teamCanDoWords({ mode: business.businessMode, lineMinor: business.spendCapMinor, currency, agentLimitMinor: LIMITS.approvalThresholdMinorDefault }).label,
    textSize: prefs.textSize,
    guidance: prefs.guidance,
    credits: plan.data ? { balance: money(plan.data.credits.balanceMinor), granted: money(plan.data.credits.grantedMinor) } : null,
    people: people.data ? people.data.length : null,
  });
  return (
    <SettingsSection title="Basics">
      <BasicsList businessId={businessId} rows={rows} />
    </SettingsSection>
  );
}
