"use client";
/**
 * Settings (BUILD §11.15, DESIGN §9): a left list of sections drawn like the sidebar (the active one on the brand
 * plate with its lit edge), right panel forms, the danger zone outlined in status-bad at 40 %. Each tab is its own
 * component; admin-only sections say so. The Keys entry carries the Anthropic key's state (Connected, None, Revoked):
 * the key left the sidebar foot (docs/UX_AUDIT_AND_PLAN.md §7.7, B13), and this list is where it is found now.
 */
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, Building2, CalendarClock, CreditCard, KeyRound, LayoutList, Plug, SlidersHorizontal, SpellCheck, Users, type LucideIcon } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { Chip, Icon, ShellLink } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { SETTINGS_TABS, type SettingsTabSlug } from "@/lib/search";
import { trpcPathPrefix } from "@/lib/trpc";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";
import { BillingTab } from "./BillingTab";
import { BusinessTab } from "./BusinessTab";
import { DangerTab } from "./DangerTab";
import { DepartmentsTab } from "./DepartmentsTab";
import { GlossaryTab } from "./GlossaryTab";
import { IntegrationsTab } from "./IntegrationsTab";
import { KeysTab } from "./KeysTab";
import { KEY_STATUS_WORDS, keyStatus } from "./key-status";
import { MembersTab } from "./MembersTab";
import { TeamCanDoTab } from "./TeamCanDoTab";
import { PreferencesTab } from "./PreferencesTab";

const ICONS: Record<SettingsTabSlug, LucideIcon> = {
  business: Building2,
  mode: SlidersHorizontal,
  departments: LayoutList,
  glossary: SpellCheck,
  members: Users,
  integrations: Plug,
  keys: KeyRound,
  billing: CreditCard,
  preferences: CalendarClock,
  danger: AlertTriangle,
};

const TABS: Record<SettingsTabSlug, () => ReactNode> = {
  business: () => <BusinessTab />,
  mode: () => <TeamCanDoTab />,
  departments: () => <DepartmentsTab />,
  glossary: () => <GlossaryTab />,
  members: () => <MembersTab />,
  integrations: () => <IntegrationsTab />,
  keys: () => <KeysTab />,
  billing: () => <BillingTab />,
  preferences: () => <PreferencesTab />,
  danger: () => <DangerTab />,
};

/** Refetch every query of the given routers after a settings mutation. */
export function useInvalidateRouters(): (routers: readonly string[]) => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async (routers) => {
    await Promise.all(routers.map((r) => qc.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));
  }, [qc]);
}

/** The Anthropic key's state beside the Keys entry, from the business row the shell holds (no query of its own). */
function KeyStatusChip() {
  const { data } = useBusiness();
  const status = keyStatus(data.business);
  const { word, tone } = KEY_STATUS_WORDS[status];
  return (
    <>
      <span className="sr-only">, Anthropic key:</span>
      <Chip tone={tone} className="ml-auto" data-testid="key-status" data-key-status={status}>
        {word}
      </Chip>
    </>
  );
}

export function SettingsScreen({ tab }: { tab: SettingsTabSlug }) {
  const { businessId } = useBusiness();
  const label = SETTINGS_TABS.find((t) => t.slug === tab)?.label ?? "Settings";
  useShellChrome({ title: `Settings · ${label}`, breadcrumbs: [{ label: "Settings", href: routes.settings(businessId, "business"), icon: Briefcase }, { label }] }, [label, businessId]);
  const Body = TABS[tab];
  return (
    <div className="settings-grid p-gutter" data-testid="settings-screen" data-tab={tab}>
      <nav aria-label="Settings sections" className="surface-panel flex flex-col gap-0.5 self-start py-1.5">
        {SETTINGS_TABS.map((t) => {
          const active = t.slug === tab;
          return (
            <ShellLink key={t.slug} href={routes.settings(businessId, t.slug)} aria-current={active ? "page" : undefined} data-active={active || undefined} className={`sidebar-item hover:no-underline ${t.slug === "danger" ? "mt-1.5" : ""}`}>
              <Icon icon={ICONS[t.slug]} size="default" data-sidebar-icon="" className={t.slug === "danger" ? "text-status-bad" : undefined} />
              {t.label}
              {t.slug === "keys" ? <KeyStatusChip /> : null}
            </ShellLink>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-col gap-gutter">{Body()}</div>
    </div>
  );
}
