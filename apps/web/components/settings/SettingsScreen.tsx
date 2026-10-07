"use client";
/**
 * Settings (BUILD §11.15, DESIGN §9): a left list of sections in tab style, right panel forms with 32 px inputs,
 * the danger zone outlined in status-bad at 40 %. Each tab is its own component; admin-only sections say so.
 */
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Briefcase, Building2, CreditCard, KeyRound, LayoutList, Plug, SlidersHorizontal, SpellCheck, Users, type LucideIcon } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { Icon, ShellLink } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets";
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
import { MembersTab } from "./MembersTab";
import { ModeTab } from "./ModeTab";

const ICONS: Record<SettingsTabSlug, LucideIcon> = {
  business: Building2,
  mode: SlidersHorizontal,
  departments: LayoutList,
  glossary: SpellCheck,
  members: Users,
  integrations: Plug,
  keys: KeyRound,
  billing: CreditCard,
  danger: AlertTriangle,
};

const TABS: Record<SettingsTabSlug, () => ReactNode> = {
  business: () => <BusinessTab />,
  mode: () => <ModeTab />,
  departments: () => <DepartmentsTab />,
  glossary: () => <GlossaryTab />,
  members: () => <MembersTab />,
  integrations: () => <IntegrationsTab />,
  keys: () => <KeysTab />,
  billing: () => <BillingTab />,
  danger: () => <DangerTab />,
};

/** Refetch every query of the given routers after a settings mutation. */
export function useInvalidateRouters(): (routers: readonly string[]) => Promise<void> {
  const qc = useQueryClient();
  return useCallback(async (routers) => {
    await Promise.all(routers.map((r) => qc.invalidateQueries({ queryKey: trpcPathPrefix(r) as unknown[] })));
  }, [qc]);
}

export function SettingsScreen({ tab }: { tab: SettingsTabSlug }) {
  const { businessId } = useBusiness();
  const label = SETTINGS_TABS.find((t) => t.slug === tab)?.label ?? "Settings";
  useShellChrome({ title: `Settings · ${label}`, breadcrumbs: [{ label: "Settings", href: routes.settings(businessId, "business"), icon: Briefcase }, { label }] }, [label, businessId]);
  const Body = TABS[tab];
  return (
    <div className="settings-grid p-gutter" data-testid="settings-screen" data-tab={tab}>
      <nav aria-label="Settings sections" className="flex flex-col gap-0.5 self-start rounded-panel border border-subtle bg-panel p-1">
        {SETTINGS_TABS.map((t) => {
          const active = t.slug === tab;
          return (
            <ShellLink key={t.slug} href={routes.settings(businessId, t.slug)} aria-current={active ? "page" : undefined} className={`flex h-8 items-center gap-2 rounded-panel px-2 t-tab ${active ? "bg-panel-alt text-primary shadow-[inset_3px_0_0_var(--kit-primary)]" : "text-secondary hover:bg-panel-alt hover:text-primary"} ${t.slug === "danger" ? "mt-2 border-t border-subtle pt-2" : ""}`}>
              <Icon icon={ICONS[t.slug]} size="default" />
              {t.label}
            </ShellLink>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-col gap-gutter">{Body()}</div>
    </div>
  );
}
