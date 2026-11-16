import type { MetadataRoute } from "next";
import { APP_ORIGIN } from "@foundmill/config";
import { AI_TRAINING_CRAWLERS, MADE_BY_PEOPLE_PATHS, PRIVATE_PATHS, indexable } from "@/lib/seo";

/**
 * robots.txt (WP-03 T6). Open to every crawler except the API and the signed-in app, and the sitemap named, once
 * sign-up is open on the production origin; closed to everything before that (lib/seo.ts `indexable`). Training
 * crawlers get their own group because a named group does not inherit from `*` (founder decision D2).
 */
export default function robots(): MetadataRoute.Robots {
  if (!indexable()) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: [...PRIVATE_PATHS] },
      { userAgent: [...AI_TRAINING_CRAWLERS], allow: "/", disallow: [...PRIVATE_PATHS, ...MADE_BY_PEOPLE_PATHS] },
    ],
    sitemap: `${APP_ORIGIN}/sitemap.xml`,
  };
}
