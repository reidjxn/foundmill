/**
 * share.opened — a member pressed a share control in the console (tap-to-post; services/shares.ts). Business-scoped;
 * any member who can read the section the shared thing belongs to; limited per person. It writes `share.opened`
 * through the outbox and answers `{ recorded }`. A share that was opened, never a post that was made.
 */
import { SHARE_DESTINATIONS, SHARE_OPEN_TARGETS, SHARE_SUBJECT_KINDS } from "@foundmill/shared";
import { z } from "zod";
import { recordShareOpened } from "../services/shares";
import { Id, businessProcedure, router } from "../trpc";

export const ShareOpenedInput = z.object({
  kind: z.enum(SHARE_SUBJECT_KINDS),
  refId: Id.nullish(),
  network: z.enum(SHARE_DESTINATIONS).nullable(),
  target: z.enum(SHARE_OPEN_TARGETS),
});

export const shareRouter = router({
  opened: businessProcedure.input(ShareOpenedInput).mutation(({ ctx, input }) => recordShareOpened(ctx, input)),
});
