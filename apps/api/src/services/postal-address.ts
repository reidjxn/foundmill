/**
 * The founders' postal address for the project's marketing email (US CAN-SPAM; founder, Nov 13, 2026), entered in
 * Settings › Integrations › Email from your project, and the founders' note that asks for it (raised by the gateway the
 * first time it refuses a marketing send without one; packages/db `repos.postalAddress.raiseNote`).
 *
 * Only the founders (owner or admin) read, enter, change or remove it: RLS on `project_postal_addresses` (0097) holds
 * that, and the procedures are admin-only too. Saving it answers the open note, so it never waits in Needs you after the
 * founder did what it asked. The audit row says that it changed, never the address.
 */
import { repos, type InboxItem } from "@foundmill/db";
import { ConflictError, ForbiddenError, POSTAL_ADDRESS_FOUNDERS_ONLY, POSTAL_ADDRESS_NOTE, ValidationError } from "@foundmill/shared";
import { audit, type BusinessContext } from "../trpc";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";

const FOUNDER_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

/** A founder of this project (owner or admin), never an example visitor. */
export const isProjectFounder = (ctx: Pick<BusinessContext, "role" | "membership">): boolean => FOUNDER_ROLES.has(ctx.role) && (ctx.membership as { source?: string }).source !== "example";

/** The address the founders entered, or null (also null for anyone else: RLS shows them nothing). */
export async function postalAddressOf(ctx: BusinessContext): Promise<string | null> {
  if (!isProjectFounder(ctx)) return null;
  return ctx.rls((tx) => repos.postalAddress.addressOf(tx, ctx.businessId));
}

/** Enters or changes the address and answers the founders' note when one is open. */
export async function setPostalAddress(ctx: BusinessContext, address: string): Promise<{ address: string; answeredNoteId: string | null }> {
  if (!isProjectFounder(ctx)) throw new ForbiddenError(POSTAL_ADDRESS_FOUNDERS_ONLY);
  return ctx.rls(async (tx) => {
    const before = await repos.postalAddress.get(tx, ctx.businessId);
    const row = await repos.postalAddress.set(tx, ctx.businessId, { address, userId: ctx.userId });
    const open = await repos.postalAddress.openNote(tx, ctx.businessId);
    const answered = open ? await answerNote(tx, ctx, open.id, POSTAL_ADDRESS_NOTE.options.add, null, open.fromAgentId, "Added the postal address for marketing email.", { params: { postal_option: POSTAL_ADDRESS_NOTE.options.add }, result: { postalAddress: "added" } }) : null;
    await audit(tx, ctx, { action: before ? "mail.postal_address.changed" : "mail.postal_address.added", target: { kind: "project_postal_address", id: row.id }, details: { answeredNoteId: answered?.item.id ?? null } });
    return { address: row.address, answeredNoteId: answered?.item.id ?? null };
  });
}

/** Removes the address: marketing email from the project's address waits again until one is entered. */
export async function clearPostalAddress(ctx: BusinessContext): Promise<{ removed: boolean }> {
  if (!isProjectFounder(ctx)) throw new ForbiddenError(POSTAL_ADDRESS_FOUNDERS_ONLY);
  return ctx.rls(async (tx) => {
    const removed = await repos.postalAddress.clear(tx, ctx.businessId);
    if (removed) await audit(tx, ctx, { action: "mail.postal_address.removed", target: { kind: "business", id: ctx.businessId }, details: {} });
    return { removed };
  });
}

/**
 * The founders' note, decided in-process like the page note: "Add it in Settings" answers it and the web opens
 * Settings › Integrations; "Later" answers it, and the gateway stays quiet for a week. Neither enters an address.
 */
export async function decidePostalAddressNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  if (!isProjectFounder(ctx)) throw new ForbiddenError(POSTAL_ADDRESS_FOUNDERS_ONLY);
  const option = input.chosenOption;
  if (option !== POSTAL_ADDRESS_NOTE.options.add && option !== POSTAL_ADDRESS_NOTE.options.later) throw new ValidationError(`Choose ${POSTAL_ADDRESS_NOTE.addLabel} or ${POSTAL_ADDRESS_NOTE.laterLabel}.`, { itemId: item.id });
  const summary = option === POSTAL_ADDRESS_NOTE.options.add ? "Opened Settings to add the postal address." : "The postal address waits until later.";
  const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, summary, { params: { postal_option: option }, result: { postalOption: option } }));
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
}
