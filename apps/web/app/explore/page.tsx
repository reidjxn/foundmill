/**
 * The public gallery (docs/holistic-plan/LAUNCH_EVALUATION.md Session 10): `/explore`, open to anyone signed out
 * (lib/auth/redirects.ts `PUBLIC_PREFIXES`), from 390 px (components/providers/DesktopOnly.tsx `SMALL_SCREEN_PREFIXES`).
 * It lists the published project pages whose founders opted in (Product › Public page › "Show in Explore"), newest
 * first, read through the API's public view. Read on every request: a page taken down or opted out is gone at once.
 */
import { PublicAppPrompt } from "@/components/shell/PublicAppPrompt";
import type { Metadata } from "next";
import { APP_NAME } from "@foundmill/config";
import { EXPLORE_WORDS, ExploreGallery } from "@foundmill/dugout";
import { publicExplore } from "@/lib/public-page.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: `${EXPLORE_WORDS.title} · ${APP_NAME}` },
  description: "Projects whose founders chose to show them, built on " + APP_NAME + ".",
  alternates: { canonical: "/explore" },
  robots: { index: true, follow: true },
};

export default async function ExplorePage() {
  const { projects } = await publicExplore();
  return (
    <>
      <ExploreGallery projects={projects} startHref="/" />
      <PublicAppPrompt />
    </>
  );
}
