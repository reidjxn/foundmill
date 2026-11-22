/**
 * The public waitlist page (WP-14 T15; founder, 2026-11-17): "Foundmill opens in batches. Batch N opens <day>. <n>
 * places." with the API's real numbers, or the plain statement that no batch is set. Public
 * (lib/auth/redirects.ts `PUBLIC_PREFIXES`), from 390 px (`SMALL_SCREEN_PREFIXES`), and the one page that is indexable
 * before sign-up opens (lib/seo.ts `waitlistIndexable`, app/robots.ts): everything else still follows SIGNUP_OPEN.
 * It asks for nothing and stores nothing: joining is signing in, as everywhere (the not-invited page saves the place).
 */
import type { Metadata } from "next";
import { APP_NAME } from "@foundmill/config";
import { WaitlistPanel } from "@/components/waitlist/WaitlistPanel";
import { WAITLIST_PAGE_WORDS } from "@/components/waitlist/words";
import { WAITLIST_PATH, waitlistIndexable } from "@/lib/seo";
import { waitlistBatch } from "@/lib/waitlist-batch.server";

export const metadata: Metadata = {
  title: { absolute: `${WAITLIST_PAGE_WORDS.title}: join the waitlist` },
  description: WAITLIST_PAGE_WORDS.description,
  alternates: { canonical: WAITLIST_PATH },
  openGraph: { title: WAITLIST_PAGE_WORDS.title, description: WAITLIST_PAGE_WORDS.description, url: WAITLIST_PATH, siteName: APP_NAME, type: "website", images: ["/opengraph-image.png"] },
  robots: { index: waitlistIndexable(), follow: waitlistIndexable() },
};

export default async function WaitlistPage() {
  return <WaitlistPanel read={await waitlistBatch()} />;
}
