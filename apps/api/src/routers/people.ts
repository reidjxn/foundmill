/**
 * The way in (docs/NETWORK.md F5; THESIS_REVIEW package 3.1): `invitation.*`.
 *
 * - `invitation.create` / `list` / `revoke`: Settings › People, the right of those who manage the project's people (an
 *   owner, a cofounder or an admin with Team write, `sectionAdmin("team")`; a cofounder invitation only an owner's or a
 *   cofounder's). services/invitations.ts.
 * - `invitation.byToken` and `invitation.decline`: public, the token is the credential, rate-limited.
 * - `invitation.accept`: signed in with a confirmed address, admitted or not (`signedInProcedure`): a valid invitation
 *   is an admission.
 */
import { z } from "zod";
import { acceptInvitation, createInvitation, CreateInvitationInput, declineInvitation, invitationByToken, listInvitations, revokeInvitation } from "../services/invitations";
import { Id, publicProcedure, router, sectionAdmin, signedInProcedure } from "../trpc";

const Token = z.object({ token: z.string().max(100) });

export const invitationRouter = router({
  create: sectionAdmin("team").input(CreateInvitationInput).mutation(({ ctx, input }) => createInvitation(ctx, input)),
  list: sectionAdmin("team").query(({ ctx }) => listInvitations(ctx)),
  revoke: sectionAdmin("team").input(z.object({ invitationId: Id })).mutation(({ ctx, input }) => revokeInvitation(ctx, input.invitationId)),
  byToken: publicProcedure.input(Token).query(({ ctx, input }) => invitationByToken(ctx, input.token)),
  accept: signedInProcedure.input(Token).mutation(({ ctx, input }) => acceptInvitation(ctx, ctx.userId, input.token)),
  decline: publicProcedure.input(Token).mutation(({ ctx, input }) => declineInvitation(ctx, input.token)),
});
