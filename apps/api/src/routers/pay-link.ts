/**
 * payLink.* — a project's payment links (WP-07 T7). A founder pastes a link made in their own Stripe account; a site's
 * pay button (`/_fm/pay/<key>`) sends visitors to it. Reading is Product's; adding and archiving are an owner's or an
 * admin's (`sectionAdmin`), never an agent's: no capability in packages/connectors reaches these procedures.
 */
import { repos, type PayLink } from "@foundmill/db";
import { AppError, ConflictError, ValidationError } from "@foundmill/shared";
import { PAY_LINK_LABEL_MAX, payLinkKeyFrom, payLinkUrlProblem } from "@foundmill/shared/pay-links";
import { z } from "zod";
import { audit, router, sectionAdmin, sectionRead, type BusinessContext } from "../trpc";

export const PAY_LINK_SAMPLE_MESSAGE = "This is a sample business, so it takes no payments. Start your own project to add a payment link.";
export const PAY_LINK_LIMIT = 20;
export const PAY_LINK_LIMIT_MESSAGE = `A project can have ${PAY_LINK_LIMIT} payment links. Remove one to add another.`;
/** Every link ever added, removed ones included (they stay, as the record of where buttons sent people). */
export const PAY_LINK_LIFETIME_LIMIT = 100;
export const PAY_LINK_LIFETIME_MESSAGE = "This project has added as many payment links as it can. Write to support to add more.";

export interface PayLinkView {
  id: string;
  key: string;
  label: string;
  priceMinor: number | null;
  currency: string | null;
  url: string;
  source: "pasted" | "stripe";
  /** A mock connector's link: never shown on the site (`site_pay_link` skips it). */
  simulated: boolean;
  createdAt: string;
}

const view = (l: PayLink): PayLinkView => ({ id: l.id, key: l.key, label: l.label, priceMinor: l.priceMinor, currency: l.currency, url: l.url, source: l.source, simulated: l.simulated, createdAt: l.createdAt.toISOString() });

export function listPayLinks(ctx: BusinessContext): Promise<PayLinkView[]> {
  return ctx.rls(async (tx) => (await repos.payLinks.list(tx, ctx.businessId)).map(view));
}

const isUnique = (e: unknown) => /unique|duplicate/i.test(String((e as { cause?: Error }).cause?.message ?? (e as Error).message));

export async function addPayLink(ctx: BusinessContext, input: { label: string; url: string; priceMinor?: number | null; currency?: string | null }): Promise<PayLinkView[]> {
  if (ctx.business.isDemo) throw new AppError("pay_link_sample_business", PAY_LINK_SAMPLE_MESSAGE, 409);
  const label = input.label.trim();
  if (!label) throw new ValidationError("Give the button a name, such as the thing it pays for.", { field: "label" });
  const url = input.url.trim();
  const problem = payLinkUrlProblem(url);
  if (problem) throw new ValidationError(problem, { field: "url" });
  if ((input.priceMinor ?? null) !== null && !input.currency) throw new ValidationError("Choose the currency of the price.", { field: "currency" });
  await ctx.rls(async (tx) => {
    const existing = await repos.payLinks.list(tx, ctx.businessId);
    if (existing.length >= PAY_LINK_LIMIT) throw new ValidationError(PAY_LINK_LIMIT_MESSAGE, { field: "url" });
    if ((await repos.payLinks.countAll(tx, ctx.businessId)) >= PAY_LINK_LIFETIME_LIMIT) throw new ValidationError(PAY_LINK_LIFETIME_MESSAGE, { field: "url" });
    if (existing.some((l) => l.url === url)) throw new ConflictError("That payment link is already on the list.");
    // A key the project used before (an archived link's included) gets a number.
    const base = payLinkKeyFrom(label);
    let key = base;
    for (let i = 2; await repos.payLinks.byKey(tx, ctx.businessId, key); i += 1) key = `${base.slice(0, 36)}-${i}`;
    try {
      const link = await repos.payLinks.add(tx, ctx.businessId, { key, label, url, priceMinor: input.priceMinor ?? null, currency: input.currency ?? null, source: "pasted", createdBy: ctx.userId });
      await audit(tx, ctx, { action: "pay_link.added", target: { kind: "pay_link", id: link.id }, details: { key, label, url, source: "pasted" } });
    } catch (e) {
      if (isUnique(e)) throw new ConflictError("Someone added a link with that name a moment ago. Try again.");
      throw e;
    }
  });
  return listPayLinks(ctx);
}

export async function archivePayLink(ctx: BusinessContext, input: { id: string }): Promise<PayLinkView[]> {
  await ctx.rls(async (tx) => {
    const link = await repos.payLinks.archive(tx, ctx.businessId, input.id);
    if (link) await audit(tx, ctx, { action: "pay_link.archived", target: { kind: "pay_link", id: link.id }, details: { key: link.key, label: link.label } });
  });
  return listPayLinks(ctx);
}

const read = sectionRead("product");
const admin = sectionAdmin("product");

export const payLinkRouter = router({
  list: read.query(({ ctx }) => listPayLinks(ctx)),
  add: admin
    .input(
      z.object({
        label: z.string().max(PAY_LINK_LABEL_MAX),
        url: z.string().max(1000),
        priceMinor: z.number().int().nonnegative().max(100_000_000).nullish(),
        currency: z.string().regex(/^[A-Z]{3}$/).nullish(),
      }),
    )
    .mutation(({ ctx, input }) => addPayLink(ctx, input)),
  archive: admin.input(z.object({ id: z.uuid() })).mutation(({ ctx, input }) => archivePayLink(ctx, input)),
});
