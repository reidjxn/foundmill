"use client";
/**
 * Your businesses › Active (founder, 2026-10-16): one row per business the founder belongs to (`founder.businesses.list`),
 * with its 32 px logo, name, role, Demo and Last opened chips, a facts line ("Pro plan · Assisted · Personal · Created
 * Oct 7, 2026"), Agents stopped while the team is stopped, Settings for owners and admins, and Open. Presentational.
 */
import { isAdminRole } from "@foundmill/shared/constants";
import { ArrowRight, Building2, Plus, Settings } from "lucide-react";
import { BUSINESS_MODE_INFO, BusinessLogo, Chip, Panel, StatusPill, type DateFormatPrefs } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { rememberLastBusiness } from "@/lib/auth/last-business";
import { formatDate, plural } from "@/lib/format";
import { ROLE_WORD } from "@/lib/roles";
import type { FounderBusiness } from "@/components/shell/business-switcher";
import { LinkButton } from "@/components/new/LinkButton";

export interface BusinessesListProps {
  rows: readonly FounderBusiness[];
  /** Business id → logo data URL (null: the initials mark). */
  logos: Readonly<Record<string, string | null>>;
  /** The business the founder opened last: a "Last opened" chip. */
  lastBusinessId?: string | null;
  prefs?: DateFormatPrefs | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCreate: () => void;
}

const tierWord = (tier: string) => tier.charAt(0).toUpperCase() + tier.slice(1);

/** "Pro plan · Assisted · Personal · Created Oct 7, 2026". */
export function businessFacts(b: Pick<FounderBusiness, "planTier" | "businessMode" | "gameMode" | "createdAt">, prefs?: DateFormatPrefs | null): string {
  return `${tierWord(b.planTier)} plan · ${BUSINESS_MODE_INFO[b.businessMode].word} · ${b.gameMode === "live" ? "LIVE" : "Personal"} · Created ${formatDate(b.createdAt, prefs)}`;
}

export function BusinessesList({ rows, logos, lastBusinessId, prefs, loading, error, onRetry, onCreate }: BusinessesListProps) {
  return (
    <Panel
      title="Active"
      meta={rows.length ? plural(rows.length, "business", "businesses") : undefined}
      loading={loading}
      error={error ?? undefined}
      onRetry={onRetry}
      empty={!loading && !error && rows.length === 0 ? { icon: Building2, children: "No businesses yet. Create one from an idea in the Ideation Studio, or import what already exists.", action: { label: "Create a new business", icon: Plus, onClick: onCreate } } : undefined}
      data-testid="active-businesses"
    >
      <ul className="flex flex-col divide-y divide-line-faint">
        {rows.map((b) => (
          <li key={b.id} data-business-row={b.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <BusinessLogo src={logos[b.id] ?? null} name={b.name} primary={b.kitPrimary} size={32} title="" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="t-display-sm min-w-0 break-words">{b.name}</span>
                <Chip>{ROLE_WORD[b.role]}</Chip>
                {b.isDemo ? <Chip>Demo</Chip> : null}
                {b.id === lastBusinessId ? <Chip tone="kit">Last opened</Chip> : null}
              </div>
              <p className="text-small text-secondary">{businessFacts(b, prefs)}</p>
            </div>
            {b.agentsStopped ? <StatusPill tone="warn">Agents stopped</StatusPill> : null}
            {isAdminRole(b.role) ? (
              <LinkButton size="sm" variant="ghost" icon={Settings} href={routes.settings(b.id, "business")} aria-label={`Settings of ${b.name}`}>
                Settings
              </LinkButton>
            ) : null}
            <LinkButton size="sm" variant="default" iconRight={ArrowRight} href={routes.today(b.id)} onClick={() => rememberLastBusiness(b.id)} aria-label={`Open ${b.name}`}>
              Open
            </LinkButton>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
