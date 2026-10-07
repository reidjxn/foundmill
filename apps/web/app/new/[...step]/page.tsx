import type { Metadata } from "next";
import { BrandPage } from "@/components/shell/BrandPage";

export const metadata: Metadata = { title: "New business" };

const TITLES: Record<string, string> = { ideate: "Ideation Studio", compare: "Compare concepts", import: "Import sources", commit: "Commit" };

/** /new/ideate · /new/compare · /new/import · /new/commit/[ideaId] (BUILD §6.2) resolve until the onboarding build lands. */
export default async function NewStepPage({ params }: { params: Promise<{ step: string[] }> }) {
  const { step } = await params;
  const first = step[0] ?? "";
  const title = TITLES[first] ?? "New business";
  return <BrandPage title={title} icon="sparkles" description={`${title} arrives with the onboarding build. This route (/new/${step.join("/")}) already resolves so links and redirects work.`} />;
}
