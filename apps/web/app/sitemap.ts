import type { MetadataRoute } from "next";
import { listedPublicPaths, sitemapEntries } from "@/lib/seo";

export const revalidate = 3600;

/** sitemap.xml (WP-03 T6): the home page and the legal pages, plus the listed project pages once WP-08 supplies them. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return sitemapEntries(await listedPublicPaths());
}
