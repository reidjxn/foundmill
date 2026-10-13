"use client";
/**
 * /b/[bid]/settings/<unknown> (audit IAE-15): the miss is a settings section, inside a business the founder can see, so
 * it says so and links to the sections that exist, instead of the business-level "No business at this address".
 */
import { ArrowRight, Briefcase, SearchX } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { EmptyState, Panel } from "@foundmill/dugout";
import { routes } from "@foundmill/widgets/shared/routes";
import { SETTINGS_TABS } from "@/lib/search";
import { useBusiness } from "@/components/shell/business-context";
import { useShellChrome } from "@/components/shell/chrome";

export function SettingsTabNotFound() {
  const { businessId } = useBusiness();
  const router = useRouter();
  const tab = decodeURIComponent(useParams<{ tab?: string }>()?.tab ?? "");
  useShellChrome({ title: "Settings", breadcrumbs: [{ label: "Settings", href: routes.settings(businessId, "business"), icon: Briefcase }, { label: "Not found" }] }, [businessId]);
  return (
    <div className="p-gutter" data-testid="settings-not-found">
      <Panel title="Settings" span={12}>
        <EmptyState icon={SearchX} title="No such settings tab" action={{ label: "Open Business settings", icon: ArrowRight, onClick: () => router.push(routes.settings(businessId, "business")) }}>
          “{tab}” is not a section of Settings. The sections are {SETTINGS_TABS.map((t) => t.label).join(", ")}.
        </EmptyState>
      </Panel>
    </div>
  );
}
