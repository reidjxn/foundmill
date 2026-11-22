import type { MetadataRoute } from "next";
import { APP_ORIGIN } from "@foundmill/config";
import { AI_TRAINING_CRAWLERS, MADE_BY_PEOPLE_PATHS, PRIVATE_PATHS, WAITLIST_PATH, indexable, waitlistIndexable } from "@/lib/seo";

/**
 * robots.txt (WP-03 T6). Open to every crawler except the API and the signed-in app, and the sitemap named, once
 * sign-up is open on the production origin; closed to everything before that (lib/seo.ts `indexable`). Training
 * crawlers get their own group because a named group does not inherit from `*` (founder decision D2).
 *
 * Before sign-up opens, on the production origin, one page is open (WP-14 T15; founder, 2026-11-17): the public waitlist
 * page, by its exact address (`$` ends the match; a crawler that does not read `$` sees no rule for the page and stays
 * out), with the build's static files and the share image so the page can be rendered and previewed, and a sitemap that names that page alone.
 */
export default function robots(): MetadataRoute.Robots {
  if (!indexable()) {
    if (!waitlistIndexable()) return { rules: { userAgent: "*", disallow: "/" } };
    return { rules: { userAgent: "*", allow: [`${WAITLIST_PATH}$`, "/_next/static/", "/opengraph-image.png"], disallow: "/" }, sitemap: `${APP_ORIGIN}/sitemap.xml` };
  }
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
      { userAgent: [...AI_TRAINING_CRAWLERS], allow: "/", disallow: [...PRIVATE_PATHS, ...MADE_BY_PEOPLE_PATHS] },
    ],
    sitemap: `${APP_ORIGIN}/sitemap.xml`,
  };
}
