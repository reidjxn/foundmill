/**
 * The way in (docs/NETWORK.md F5; THESIS_REVIEW package 3.1): `invitation.*`.
 *
 * - `invitation.create` / `list` / `revoke`: Settings › People, the right of those who manage the project's people (an
 *   owner, a cofounder or an admin with Team write, `sectionAdmin("team")`; a cofounder invitation only an owner's or a
 *   cofounder's). services/invitations.ts.
 * - `invitation.byToken` and `invitation.decline`: public, rate-limited. The token is the credential for reading it and
 *   for declining a link-only invitation; declining one that names an address needs the account signed in with it,
 *   as accepting does.
 * - `invitation.accept`: signed in with a confirmed address, admitted or not (`signedInProcedure`): the invitation adds
 *   the membership, and admits the account on its inviter's standing (services/access.ts `admitThroughInvitation`).
 *   An invitation to an address is accepted only by the account signed in with it: the address is the token's
 *   (`ctx.email`), or, for a development account's token (which carries none, services/dev-users.ts), the stub
 *   account's own in `auth.users`.
 */
import { repos } from "@foundmill/db";
import { z } from "zod";
import type { Context } from "../context";
import { devUserBootstrapEnabled } from "../services/dev-users";
import { acceptInvitation, createInvitation, CreateInvitationInput, declineInvitation, invitationByToken, listInvitations, revokeInvitation } from "../services/invitations";
import { Id, publicProcedure, router, sectionAdmin, signedInProcedure } from "../trpc";

const Token = z.object({ token: z.string().max(100) });

/** The address the signed-in account accepts with (see the file comment). */
async function signedInAddress(ctx: Pick<Context, "db" | "env" | "email">, userId: string): Promise<string | null> {
  if (ctx.email) return ctx.email;
  return devUserBootstrapEnabled(ctx.env) ? repos.founders.emailOf(ctx.db, userId) : null;
}

export const invitationRouter = router({
  create: sectionAdmin("team").input(CreateInvitationInput).mutation(({ ctx, input }) => createInvitation(ctx, input)),
  list: sectionAdmin("team").query(({ ctx }) => listInvitations(ctx)),
  revoke: sectionAdmin("team").input(z.object({ invitationId: Id })).mutation(({ ctx, input }) => revokeInvitation(ctx, input.invitationId)),
  byToken: publicProcedure.input(Token).query(({ ctx, input }) => invitationByToken(ctx, input.token)),
  accept: signedInProcedure.input(Token).mutation(async ({ ctx, input }) => acceptInvitation(ctx, { userId: ctx.userId, email: await signedInAddress(ctx, ctx.userId), emailConfirmed: ctx.emailConfirmed }, input.token)),
  decline: publicProcedure
    .input(Token)
    .mutation(async ({ ctx, input }) => declineInvitation(ctx, input.token, ctx.userId ? { userId: ctx.userId, email: await signedInAddress(ctx, ctx.userId), emailConfirmed: ctx.emailConfirmed === true } : null)),
});
