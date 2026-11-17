/**
 * site.* — Foundmill Sites in the console (WP-07 T5; services/sites.ts). Reading is Product's; publishing, taking down
 * and moving the address are an owner's or an admin's (`sectionAdmin`), never an agent's.
 */
import { PAGE_SLUG_MAX } from "@foundmill/shared";
import { z } from "zod";
import { publishSite, setSiteSlug, siteView, unpublishSite } from "../services/sites";
import { router, sectionAdmin, sectionRead } from "../trpc";

const read = sectionRead("product");
const admin = sectionAdmin("product");

export const siteRouter = router({
  get: read.query(({ ctx }) => siteView(ctx)),
  publish: admin.input(z.object({ releaseId: z.uuid() })).mutation(({ ctx, input }) => publishSite(ctx, input)),
  unpublish: admin.mutation(({ ctx }) => unpublishSite(ctx)),
  setSlug: admin.input(z.object({ slug: z.string().max(PAGE_SLUG_MAX * 2) })).mutation(({ ctx, input }) => setSiteSlug(ctx, input)),
});
