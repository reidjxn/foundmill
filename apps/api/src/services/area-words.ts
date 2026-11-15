/**
 * `business.areas.words`: each founder area's opening sentence as one read, for the mobile app (docs/mobile, Nov 11,
 * 2026). The web builds the same sentences in the browser from the tiles' own reads (@foundmill/modules AreaOpening); a
 * second client that copied six fact-gathering paths would drift from the web's words, so the api gathers the same
 * facts here with the reads it already has and hands them to the shared builders (@foundmill/shared area-facts.ts and
 * area-words.ts). No model call; one transaction under the caller's RLS.
 *
 * Walls follow the area's own screens: Money needs Finance read, Company Legal read, the roadmap part of Plan Product
 * read (the goal masks itself in `goalView`), Customers Distribution read, the live-changes part of Product Development
 * read, Team Team read. A walled area answers null, so the client shows nothing rather than a sentence it made up.
 */
import { loadProductStage, repos, type DbTx } from "@foundmill/db";
import {
  companyAreaWords,
  companyFacts,
  customersAreaWords,
  customersFacts,
  dayKeyIn,
  hasSectionAccess,
  moneyAreaWords,
  moneyFacts,
  planAreaWords,
  planFacts,
  productAreaWords,
  productFacts,
  teamAreaWords,
  teamFacts,
  CHANNEL_META,
  type AreaWords,
  type ChannelKey,
} from "@foundmill/shared";
import { channelWindow } from "../routers/distribution";
import type { BusinessContext } from "../trpc";
import { goalView } from "./goals";

export interface AreaWordsView {
  /** The business's day the sentences were built on ("2026-11-11"). */
  today: string;
  plan: AreaWords | null;
  customers: AreaWords | null;
  money: AreaWords | null;
  /** The Company line under Money's sentence. */
  company: AreaWords | null;
  product: AreaWords | null;
  team: AreaWords | null;
}

const TRAILING_MONTHS = 3;

async function moneyWords(tx: DbTx, ctx: BusinessContext): Promise<AreaWords> {
  const [cash, burn] = await Promise.all([repos.finance.cashPosition(tx, ctx.businessId), repos.finance.netBurn(tx, ctx.businessId, { months: TRAILING_MONTHS })]);
  const base = cash.byCurrency[0];
  const cashMinor = base?.balanceMinor ?? 0;
  // The same arithmetic as finance.overview, so the sentence and the Runway tile agree to the decimal.
  const runwayMonths = burn.netBurnMinor > 0 ? Math.round((cashMinor / burn.netBurnMinor) * 10) / 10 : null;
  return moneyAreaWords(
    moneyFacts(
      { cash: { amountMinor: cashMinor, currency: base?.currency ?? ctx.business.currency, accounts: cash.accounts.length }, burn: { netBurnMinor: burn.netBurnMinor, grossBurnMinor: burn.grossBurnMinor }, runway: { months: runwayMonths } },
      ctx.business.currency,
    ),
  );
}

async function companyWords(tx: DbTx, ctx: BusinessContext, today: string, now: Date): Promise<AreaWords> {
  const [entity, events, upcoming, filings] = await Promise.all([
    repos.legal.primaryEntity(tx, ctx.businessId),
    repos.legal.listCompliance(tx, ctx.businessId, { pendingOnly: false }),
    repos.legal.upcomingDeadlines(tx, ctx.businessId, 365, now),
    repos.legal.listFilings(tx, ctx.businessId, { limit: 200 }),
  ]);
  return companyAreaWords(companyFacts({ entity: entity ? { legalName: entity.legalName, status: entity.status } : null }, { events, upcoming, filings: filings.items }, today));
}

async function planWords(tx: DbTx, ctx: BusinessContext, today: string, productRead: boolean): Promise<AreaWords> {
  const [goals, roadmap] = await Promise.all([goalView(tx, ctx), productRead ? repos.product.listRoadmap(tx, ctx.businessId) : Promise.resolve(null)]);
  return planAreaWords(planFacts(goals, roadmap ? { items: roadmap } : null, today));
}

async function customersWords(tx: DbTx, ctx: BusinessContext, now: Date): Promise<AreaWords> {
  if (ctx.business.distributionStartedAt === null) return customersAreaWords(customersFacts(false, undefined, null));
  const [channels, summary, campaigns] = await Promise.all([
    repos.channels.list(tx, ctx.businessId),
    repos.channels.metricsSummary(tx, ctx.businessId, channelWindow(now, ctx.business.timeZone)),
    repos.campaigns.list(tx, ctx.businessId, { status: "live", limit: 200 }),
  ]);
  const rows = channels.map((c) => ({ channelKey: c.channelKey, meta: CHANNEL_META[c.channelKey as ChannelKey] ?? null, form: summary.channels.find((s) => s.channelId === c.id) ?? null }));
  return customersAreaWords(customersFacts(true, { channels: rows, blended: summary.blended }, campaigns));
}

async function productWords(tx: DbTx, ctx: BusinessContext, today: string, developmentRead: boolean): Promise<AreaWords> {
  const { stage } = await loadProductStage(tx, ctx.businessId);
  if (!developmentRead) return productAreaWords(productFacts(stage, null, null, today));
  const [tasks, merged, deployments] = await Promise.all([
    repos.tasks.list(tx, ctx.businessId, { kind: "code", status: ["review", "merging", "done"], limit: 200 }),
    repos.events.list(tx, ctx.businessId, { type: "pr.merged", limit: 200 }),
    repos.events.list(tx, ctx.businessId, { type: "deploy.succeeded", limit: 100 }),
  ]);
  // The same rows as dev.prs.list: GitHub's merged events, plus every done code task the merge queue landed without one.
  const reported = new Set(merged.items.map((e) => (e.payload as { taskId?: unknown }).taskId).filter((id): id is string => typeof id === "string"));
  const prs = {
    open: tasks.items.filter((t) => t.status !== "done").map((t) => ({ kind: t.kind })),
    merged: [...merged.items.map((e) => ({ occurredAt: e.occurredAt })), ...tasks.items.filter((t) => t.status === "done" && !reported.has(t.id)).map((t) => ({ occurredAt: t.endedAt ?? t.updatedAt }))],
  };
  const live = { items: deployments.items.map((e) => ({ environment: String((e.payload as { environment?: unknown }).environment ?? ""), occurredAt: e.occurredAt })) };
  return productAreaWords(productFacts(stage, prs, live, today));
}

async function teamWords(tx: DbTx, ctx: BusinessContext): Promise<AreaWords> {
  const [agents, departments] = await Promise.all([repos.agents.list(tx, ctx.businessId, { limit: 500 }), repos.departments.list(tx, ctx.businessId)]);
  // The stored name: the client renders the mention through its own naming preference (EntityText), as the web does.
  const { facts } = teamFacts(agents.items, departments, (a) => a.name);
  return teamAreaWords(facts);
}

/** Every area's sentence, as this reader may see it. */
export async function areaWordsFor(ctx: BusinessContext, now: Date = new Date()): Promise<AreaWordsView> {
  const m = ctx.membership;
  const can = (section: Parameters<typeof hasSectionAccess>[1]) => hasSectionAccess(m, section, "read");
  const today = dayKeyIn(now, ctx.business.timeZone);
  const none = Promise.resolve(null);
  return ctx.rls(async (tx) => {
    const [plan, customers, money, company, product, team] = await Promise.all([
      planWords(tx, ctx, today, can("product")),
      can("distribution") ? customersWords(tx, ctx, now) : none,
      can("finance") ? moneyWords(tx, ctx) : none,
      can("legal") ? companyWords(tx, ctx, today, now) : none,
      can("product") || can("development") ? productWords(tx, ctx, today, can("development")) : none,
      can("team") ? teamWords(tx, ctx) : none,
    ]);
    return { today, plan, customers, money, company, product, team };
  });
}
