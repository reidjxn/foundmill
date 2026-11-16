/**
 * positioning.* — the project's positioning notes on Product › Vision (services/positioning.ts; WP-08 T1).
 *
 * - `get`: any member with Product read.
 * - `save`, `requestDraft`: Product write.
 * - `approve`: an owner or an admin with Product write, by their own press; no agent tool reaches it.
 */
import { PositioningNotesInput } from "@foundmill/shared";
import { z } from "zod";
import { approvePositioning, positioningView, requestPositioningDraft, savePositioning } from "../services/positioning";
import { modelLimited } from "../services/model-limits";
import { router, sectionAdmin, sectionRead, sectionWrite } from "../trpc";

const read = sectionRead("product");
const write = sectionWrite("product");
const approve = sectionAdmin("product");

export const positioningRouter = router({
  get: read.query(({ ctx }) => positioningView(ctx)),
  save: write.input(z.object({ notes: PositioningNotesInput })).mutation(({ ctx, input }) => savePositioning(ctx, input)),
  approve: approve.input(z.object({ notes: PositioningNotesInput })).mutation(({ ctx, input }) => approvePositioning(ctx, input)),
  requestDraft: write.use(modelLimited("positioning")).mutation(({ ctx }) => requestPositioningDraft(ctx)),
});
