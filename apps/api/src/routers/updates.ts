/**
 * updates.* (WP-08 T3): the founders' updates to their followers, on Product › Public page (services/updates.ts). Read
 * and preview with Distribution read; save a draft with Distribution write; Send (and Send the rest) and Delete draft for
 * an owner or an admin with Distribution write.
 */
import { PROJECT_UPDATE_BODY_MAX, PROJECT_UPDATE_SUBJECT_MAX } from "@foundmill/shared";
import { z } from "zod";
import { Id, router, sectionAdmin, sectionRead, sectionWrite } from "../trpc";
import { modelLimited } from "../services/model-limits";
import { cancelUpdate, getUpdate, listUpdates, previewUpdate, saveUpdate, sendUpdate } from "../services/updates";

const read = sectionRead("distribution");
const write = sectionWrite("distribution");
const admin = sectionAdmin("distribution");

export const updatesRouter = router({
  list: read.query(({ ctx }) => listUpdates(ctx)),
  get: read.input(z.object({ id: Id })).query(({ ctx, input }) => getUpdate(ctx, input.id)),
  preview: read.input(z.object({ id: Id })).query(({ ctx, input }) => previewUpdate(ctx, input.id)),
  save: write.input(z.object({ id: Id.optional(), subject: z.string().trim().min(1).max(PROJECT_UPDATE_SUBJECT_MAX), body: z.string().trim().min(1).max(PROJECT_UPDATE_BODY_MAX) })).mutation(({ ctx, input }) => saveUpdate(ctx, input)),
  send: admin.input(z.object({ id: Id, seenUpdatedAt: z.iso.datetime({ offset: true }).optional() })).use(modelLimited("followerUpdate")).mutation(({ ctx, input }) => sendUpdate(ctx, input.id, input.seenUpdatedAt)),
  cancel: admin.input(z.object({ id: Id })).mutation(({ ctx, input }) => cancelUpdate(ctx, input.id)),
});
