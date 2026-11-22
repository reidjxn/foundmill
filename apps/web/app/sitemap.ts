import type { MetadataRoute } from "next";
import { indexable, listedPublicPaths, sitemapEntries } from "@/lib/seo";

export const revalidate = 3600;

/**
 * sitemap.xml (WP-03 T6): the home page, the legal pages and the waitlist page, plus the listed project pages once WP-08
 * supplies them. Until sign-up opens it names the waitlist page alone (WP-14 T15), the one address robots.txt allows.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (!indexable()) return sitemapEntries([], { open: false });
  return sitemapEntries(await listedPublicPaths());
}
