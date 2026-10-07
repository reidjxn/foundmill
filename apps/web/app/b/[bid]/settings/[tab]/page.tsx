import { notFound } from "next/navigation";
import { SETTINGS_TABS, type SettingsTabSlug } from "@/lib/search";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export const dynamic = "force-dynamic";

const SLUGS = SETTINGS_TABS.map((t) => t.slug) as readonly string[];

/** /b/[bid]/settings/[tab] — business | mode | departments | glossary | members | integrations | keys | billing | danger (BUILD §11.15). */
export default async function SettingsPage({ params }: { params: Promise<{ bid: string; tab: string }> }) {
  const { tab } = await params;
  if (!SLUGS.includes(tab)) notFound();
  return <SettingsScreen tab={tab as SettingsTabSlug} />;
}
