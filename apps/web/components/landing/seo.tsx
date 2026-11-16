/**
 * What search engines, answer engines and link previews read about `/` (DIRECTION §4 "Metadata"; s3 finding 1, §3.1).
 * The title and description are written for the first-timer; the share image is the home's own
 * (app/examples/home-share/route.tsx); one JSON-LD block names the organization, the site and the app with its free
 * offer, and nothing else (no FAQ or how-to markup, no ratings: there are none). Indexing follows open sign-up
 * (founder, 2026-11-15): an indexed page that ends at a waitlist would spend the one first impression a search gives.
 *
 * robots.ts, sitemap.ts and /llms.txt belong to the main plan's WP-03 T6 and are not here.
 */
import type { Metadata } from "next";
import { APP_NAME, APP_ORIGIN } from "@foundmill/config";
import type { LandingSwitches } from "./flags";
import { LANDING_WORDS } from "./words";

export const HOME_TITLE = `${APP_NAME} | Start your first project with one sentence`;
export const HOME_DESCRIPTION = "Say your idea in a sentence. A team of AI agents shapes it and rates it honestly, free and before you sign up. Build it alone or with people.";
/** The home's share image (1200 × 630), served by app/examples/home-share/route.tsx. */
export const HOME_SHARE_IMAGE = "/examples/home-share";
export const HOME_SHARE_ALT = `${LANDING_WORDS.hero.title} ${APP_NAME}.`;

export function homeMetadata(switches: LandingSwitches): Metadata {
  const indexed = switches.signupOpen;
  return {
    title: { absolute: HOME_TITLE },
    description: HOME_DESCRIPTION,
    alternates: { canonical: "/" },
    openGraph: {
      title: HOME_TITLE,
      description: HOME_DESCRIPTION,
      url: "/",
      siteName: APP_NAME,
      type: "website",
      locale: "en_US",
      images: [{ url: HOME_SHARE_IMAGE, width: 1200, height: 630, alt: HOME_SHARE_ALT }],
    },
    twitter: { card: "summary_large_image", title: HOME_TITLE, description: HOME_DESCRIPTION, images: [HOME_SHARE_IMAGE] },
    robots: { index: indexed, follow: indexed },
  };
}

type Node = Record<string, unknown> & { "@type": string };

export function homeJsonLd(): { "@context": string; "@graph": Node[] } {
  const org = `${APP_ORIGIN}/#org`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": org, name: APP_NAME, url: `${APP_ORIGIN}/`, logo: `${APP_ORIGIN}/brand/foundmill-icon-512.png` },
      { "@type": "WebSite", "@id": `${APP_ORIGIN}/#website`, name: APP_NAME, url: `${APP_ORIGIN}/`, inLanguage: "en-US", publisher: { "@id": org } },
      {
        "@type": "SoftwareApplication",
        name: APP_NAME,
        url: `${APP_ORIGIN}/`,
        description: LANDING_WORDS.footer.what,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": org },
      },
    ],
  };
}

/** The one JSON-LD block, its `<` escaped so no string in it can close the script tag. */
export function HomeJsonLd() {
  const json = JSON.stringify(homeJsonLd()).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
