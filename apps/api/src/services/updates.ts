/**
 * Write to your followers (WP-08 T3; audit a5 GTM-01): the founders' updates, from Product › Public page.
 *
 * Members with Distribution read the updates and the preview; members with Distribution write save a draft (under RLS:
 * the words only); an owner or an admin with Distribution write presses Send (`sectionAdmin`), which asks the gateway
 * (`POST /v1/platform-mail/send-update`): the api never reads or sends a follower's address. Pressing it again the next
 * day sends the rest. A sample business sends nothing. What the screen says comes back in plain words, and a simulated
 * press is never shown as sent.
 */
import { platformMailFooter } from "@foundmill/connectors";
import { repos, type ProjectUpdate } from "@foundmill/db";
import { AppError, aiFooterLine, firstNameOf, PROJECT_UPDATE_REFUSALS, PROJECT_UPDATE_WORDS, updateText } from "@foundmill/shared";
import { audit, emit, type BusinessContext } from "../trpc";

const view = (u: ProjectUpdate) => ({ id: u.id, subject: u.subject, body: u.body, status: u.status, draftedByAgentId: u.draftedByAgentId, sentCount: u.sentCount, skippedCount: u.skippedCount, remainingCount: u.remainingCount, approvedAt: u.approvedAt?.toISOString() ?? null, createdAt: u.createdAt.toISOString(), updatedAt: u.updatedAt.toISOString() });
export type ProjectUpdateView = ReturnType<typeof view>;

const found = (u: ProjectUpdate | null, id: string): ProjectUpdate => {
  if (!u) throw new AppError("not_found", "That update is no longer here", 404, { id });
  return u;
};

export async function listUpdates(ctx: BusinessContext) {
  const [rows, followers, postal] = await ctx.rls(async (tx) => Promise.all([repos.updates.list(tx, ctx.businessId, 20), repos.followers.count(tx, ctx.businessId), repos.postalAddress.addressOf(tx, ctx.businessId)]));
  // Send is an owner's or an admin's press (`sectionAdmin`); the screen shows it only to them.
  // The postal address comes before a first update, so the panel can say so before anyone writes one.
  return { followers, canSend: ctx.role === "owner" || ctx.role === "admin", postalAddressMissing: postal === null, updates: rows.map(view) };
}

export async function getUpdate(ctx: BusinessContext, id: string) {
  return view(found(await ctx.rls((tx) => repos.updates.get(tx, ctx.businessId, id)), id));
}

export async function saveUpdate(ctx: BusinessContext, input: { id?: string; subject: string; body: string }) {
  return ctx.rls(async (tx) => {
    const row = await repos.updates.saveDraft(tx, ctx.businessId, input);
    await audit(tx, ctx, { action: input.id ? "updates.save" : "updates.create", target: { kind: "project_update", id: row.id } });
    if (!input.id) await emit(tx, ctx, { type: "update.drafted", payload: { updateId: row.id, agentId: null } });
    return view(row);
  });
}

/** Exactly what a follower gets: the subject, the words, the AI line (founder D2) and the footer the gateway adds. */
export async function previewUpdate(ctx: BusinessContext, id: string) {
  const { row, followers, postal, me, mail } = await ctx.rls(async (tx) => ({
    row: found(await repos.updates.get(tx, ctx.businessId, id), id),
    followers: await repos.followers.count(tx, ctx.businessId),
    postal: await repos.postalAddress.addressOf(tx, ctx.businessId),
    me: await repos.founders.get(tx, ctx.userId),
    mail: await repos.projectMail.get(tx, ctx.businessId).catch(() => null),
  }));
  const aiLine = aiFooterLine({ draftedByAgent: row.draftedByAgentId !== null, checkerFirstName: firstNameOf(me?.displayName) });
  return {
    subject: row.subject,
    text: updateText(row.body, aiLine),
    footer: platformMailFooter(ctx.business.name, "(a link to stop these emails)", postal).text.trim(),
    followers,
    /** The project's own day of email (`project_mail.daily_cap`, else the deployment's default): one press sends up to it. */
    perDay: mail?.dailyCap ?? ctx.env.PLATFORM_MAIL_DAILY_CAP,
    postalAddressMissing: postal === null,
  };
}

export type SendUpdateOutcome = { sent: number; skipped: number; remaining: number; simulated: boolean; refusal: string | null; message: string };

export async function sendUpdate(ctx: BusinessContext, id: string, seenUpdatedAt?: string): Promise<SendUpdateOutcome> {
  if (ctx.business.isDemo) return { sent: 0, skipped: 0, remaining: 0, simulated: true, refusal: "simulated", message: PROJECT_UPDATE_REFUSALS.simulated! };
  const row = found(await ctx.rls((tx) => repos.updates.get(tx, ctx.businessId, id)), id);
  if (row.status !== "draft" && row.status !== "sending") return { sent: row.sentCount, skipped: row.skippedCount, remaining: 0, simulated: false, refusal: "not_draft", message: PROJECT_UPDATE_REFUSALS.not_draft! };
  if (!ctx.gateway.sendUpdate) return { sent: 0, skipped: 0, remaining: 0, simulated: false, refusal: "off", message: PROJECT_UPDATE_REFUSALS.off! };
  const r = await ctx.gateway.sendUpdate({ businessId: ctx.businessId, updateId: id, userId: ctx.userId, ...(seenUpdatedAt ? { seenUpdatedAt } : {}) });
  await ctx.rls((tx) => audit(tx, ctx, { action: "updates.send", target: { kind: "project_update", id }, details: { sent: r.sent, skipped: r.skipped, remaining: r.remaining, simulated: r.simulated, refusal: r.refusal } }));
  const message = r.simulated
    ? PROJECT_UPDATE_WORDS.simulated
    : r.sent === 0 && r.refusal
      ? (PROJECT_UPDATE_REFUSALS[r.refusal] ?? PROJECT_UPDATE_REFUSALS.vendor!)
      : r.remaining > 0
        ? PROJECT_UPDATE_WORDS.sentWithRest(r.sent, r.remaining)
        : PROJECT_UPDATE_WORDS.sent(r.sent);
  return { ...r, message };
}

/** A draft deleted (kept as canceled): the status is the services', so this runs on the service connection after the check. */
export async function cancelUpdate(ctx: BusinessContext, id: string) {
  found(await ctx.rls((tx) => repos.updates.get(tx, ctx.businessId, id)), id);
  const canceled = await repos.updates.cancel(ctx.db, ctx.businessId, id);
  await ctx.rls((tx) => audit(tx, ctx, { action: "updates.cancel", target: { kind: "project_update", id }, details: { canceled } }));
  return { canceled };
}
