import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SETTINGS_TABS, type SettingsTabSlug } from "@/lib/search";
import { settingsTitle } from "@/lib/page-titles";
import { SettingsScreen } from "@/components/settings/SettingsScreen";

export const dynamic = "force-dynamic";

const SLUGS = SETTINGS_TABS.map((t) => t.slug) as readonly string[];

type Params = Promise<{ bid: string; tab: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { tab } = await params;
  return { title: settingsTitle(tab) };
}

/** /b/[bid]/settings/[tab] — business | mode | departments | glossary | members | integrations | keys | billing | preferences | danger (BUILD §11.15; preferences is the signed-in person's own, in every business). An unknown tab renders ./not-found.tsx. */
export default async function SettingsPage({ params }: { params: Params }) {
  const { tab } = await params;
  if (!SLUGS.includes(tab)) notFound();
  return <SettingsScreen tab={tab as SettingsTabSlug} />;
}
