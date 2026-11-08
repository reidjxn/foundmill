/**
 * Today, the business's front door (founder, 2026-11-07): what needs the founder, the week in plain sentences and the
 * week's spend, in one read (`today.get`). The goal itself is `goal.current` / `goal.ensure` (services/goals.ts); the
 * cash, runway and customers figures are the ones every other screen reads (`finance.overview`, `journey.ribbon`).
 *
 * - **Needs you**: the first three notes of the Inbox's Needs you tab, as this reader may read them (the same walls as
 *   `inbox.list`), each with `quickOptionId` only where one tap answers it without the plan compiler: an agent's request
 *   (Approve, when the reader can write the section it touches), a specification or roadmap sign-off (Approve) and the
 *   Chief of Staff's goal (Approve this goal). Everything else opens in the Inbox.
 * - **This week and next**: the sentences of packages/shared today-words.ts from tasks, the roadmap, the round of work
 *   and Autopilot (no model call). Without Development read there are none.
 * - **Spend**: never added across currencies (founder, 2026-11-07). AI usage this week in US dollars (the usage ledger's
 *   USD rows, an Estimate) and channel spend this week in the business's own currency (channel metrics, an Estimate).
 *   Finance read only.
 */
import { APPROVAL_OPTIONS, approvalSection, repos, type DbTx, type InboxItem, type Task } from "@foundmill/db";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { GOAL_OPTION_IDS, WRITE_ROLES, addDaysToDay, dayKeyIn, hasSectionAccess, weekPlanWords, type WeekFacts, type WeekPlanWords } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { autopilotStatus } from "./autopilot";
import { cycleStatus } from "./cycle";
import { idsOfItem, inboxWalls, loadRedactionSource, redactInboxItem } from "./inbox-redaction";

/** How many notes Today shows (the rest wait in the Inbox behind "See all in the Inbox"). */
export const TODAY_NEEDS_YOU_MAX = 3;

export type NeedsYouKind = "approval" | "signoff" | "goal" | "decision" | "warning" | "go_ahead";

export interface NeedsYouItem {
  id: string;
  type: InboxItem["type"];
  subject: string;
  createdAt: Date;
  blocksContinue: boolean;
  kind: NeedsYouKind;
  /** The sender with what the web needs to name it under the reader's preference (role, persona key, layer). */
  fromAgent: { id: string; name: string; role: string | null; personaKey: string | null; layer: string | null } | null;
  /** The one option a single tap may choose, with its label as the note shows it; null opens the note instead. */
  quickOption: { id: string; label: string } | null;
}

export interface TodaySpend {
  /** AI usage this week, US dollars (minor units), an Estimate. */
  aiUsage: { amountMinor: number; currency: typeof CREDITS_CURRENCY };
  /**
   * Channel spend this week in the business's own currency (minor units), an Estimate. A channel kept in another
   * currency is listed under `otherCurrencies`, never added in.
   */
  channel: { amountMinor: number; currency: string; otherCurrencies: { currency: string; amountMinor: number }[] };
}

export interface TodayView {
  /** The business's day ("2026-11-07"). */
  today: string;
  /** Null without Inbox read. */
  needsYou: { items: NeedsYouItem[]; total: number } | null;
  /** Null without Development read. */
  week: WeekPlanWords | null;
  /** Null without Finance read. */
  spend: TodaySpend | null;
  /** The business's Chief of Staff by its stored name (the goal's proposer). */
  chiefOfStaff: { id: string; name: string } | null;
}

interface DecisionOption {
  id: string;
  label?: string;
}

const optionLabel = (item: InboxItem, id: string): string | null => {
  const options = ((item.decision as { options?: DecisionOption[] } | null)?.options ?? []) as DecisionOption[];
  const found = options.find((o) => o.id === id);
  return found ? (found.label?.trim() || null) : null;
};

/** May answer a note in one tap at all: a writing role with Inbox write, never an example viewer. */
function mayAnswer(ctx: Pick<BusinessContext, "role" | "membership">): boolean {
  if ((ctx.membership as { source?: string }).source === "example") return false;
  return (WRITE_ROLES as readonly string[]).includes(ctx.role) && hasSectionAccess(ctx.membership, "inbox", "write");
}

/** What a note is and the one tap that answers it, when there is one. */
async function quickAnswerFor(tx: DbTx, ctx: BusinessContext, item: InboxItem, awaiting: boolean, canAnswer: boolean): Promise<{ kind: NeedsYouKind; quickOption: NeedsYouItem["quickOption"] }> {
  if (awaiting) return { kind: "go_ahead", quickOption: null };
  const open = item.state === "unread" || item.state === "read";
  const [approval, signoff, goal] = await Promise.all([repos.approvals.forInboxItem(tx, ctx.businessId, item.id), repos.productSignoffs.forInboxItem(tx, ctx.businessId, item.id), repos.goals.forInboxItem(tx, ctx.businessId, item.id)]);
  const quick = (id: string, allowed: boolean) => {
    const label = optionLabel(item, id);
    return open && canAnswer && allowed && label ? { id, label } : null;
  };
  if (approval) return { kind: "approval", quickOption: quick(APPROVAL_OPTIONS.approve, approval.outcome === null && hasSectionAccess(ctx.membership, approvalSection(approval) ?? "inbox", "write")) };
  if (signoff) return { kind: "signoff", quickOption: quick("approve", (signoff.kind === "spec" || signoff.kind === "roadmap") && signoff.status === "pending") };
  if (goal) return { kind: "goal", quickOption: quick(GOAL_OPTION_IDS.approve, goal.status === "proposed") };
  return { kind: item.type === "warning" ? "warning" : "decision", quickOption: null };
}

/** The first notes of Needs you as this reader sees them, and how many wait in all. */
export async function needsYouFor(tx: DbTx, ctx: BusinessContext): Promise<{ items: NeedsYouItem[]; total: number }> {
  const [page, counts] = await Promise.all([repos.inbox.list(tx, ctx.businessId, { tab: "respond", limit: TODAY_NEEDS_YOU_MAX }, ctx.userId), repos.inbox.countByTab(tx, ctx.businessId)]);
  const rows = page.items.slice(0, TODAY_NEEDS_YOU_MAX);
  if (rows.length === 0) return { items: [], total: counts.respond };
  const walls = inboxWalls(ctx.membership);
  const [source, waiting, agents] = await Promise.all([
    loadRedactionSource(tx, ctx.businessId, walls, rows.flatMap(idsOfItem)),
    repos.plans.awaitingConfirmation(tx, ctx.businessId, rows.map((r) => r.id)),
    repos.agents.byIds(tx, ctx.businessId, [...new Set(rows.map((r) => r.fromAgentId).filter((id): id is string => !!id))]),
  ]);
  const byId = new Map(agents.map((a) => [a.id, a]));
  const canAnswer = mayAnswer(ctx);
  // Every note's kind in one wave (three reads per note, sent together).
  const answers = await Promise.all(rows.map((row) => quickAnswerFor(tx, ctx, row, row.state === "answered" && waiting.has(row.id), canAnswer)));
  const items: NeedsYouItem[] = rows.map((row, i) => {
    const { kind, quickOption } = answers[i]!;
    const agent = row.fromAgentId ? byId.get(row.fromAgentId) : undefined;
    return { id: row.id, type: row.type, subject: redactInboxItem(row, source).subject, createdAt: row.createdAt, blocksContinue: row.blocksContinue, kind, fromAgent: agent ? { id: agent.id, name: agent.name, role: agent.role || null, personaKey: agent.personaKey ?? null, layer: agent.layer ?? null } : null, quickOption };
  });
  return { items, total: Math.max(counts.respond, items.length) };
}

const titleOf = (t: Pick<Task, "founderTitle" | "title">): string => (t.founderTitle ?? t.title).trim();
const DONE_LOOKBACK = 200;
const ROADMAP_FINISHED: ReadonlySet<string> = new Set(["done", "shipped", "archived"]);

/** The facts behind "This week and next", in the business's time zone. */
export async function weekFactsFor(tx: DbTx, ctx: BusinessContext, options: { now?: Date; autopilotNextOn?: string | null } = {}): Promise<WeekFacts> {
  const now = options.now ?? new Date();
  const zone = ctx.business.timeZone;
  const today = dayKeyIn(now, zone);
  const since = now.getTime() - 7 * 86_400_000;
  const [done, running, queued, counts, roadmap, cycle] = await Promise.all([
    repos.tasks.list(tx, ctx.businessId, { status: "done", limit: DONE_LOOKBACK }),
    repos.tasks.list(tx, ctx.businessId, { status: "running", limit: 20 }),
    repos.tasks.list(tx, ctx.businessId, { status: ["ready", "planned"], limit: 100 }),
    repos.tasks.countByStatus(tx, ctx.businessId),
    hasSectionAccess(ctx.membership, "product", "read") ? repos.product.listRoadmap(tx, ctx.businessId) : Promise.resolve([]),
    cycleStatus({ db: tx, businessId: ctx.businessId }),
  ]);
  const finished = done.items.filter((t) => t.endedAt && t.endedAt.getTime() >= since);
  const titles = new Map(roadmap.map((r) => [r.id, r.title]));
  const byItem = new Map<string, number>();
  for (const t of finished) if (t.roadmapItemId && titles.has(t.roadmapItemId)) byItem.set(t.roadmapItemId, (byItem.get(t.roadmapItemId) ?? 0) + 1);
  const top = [...byItem.entries()].sort((a, b) => b[1] - a[1])[0];
  const oldestFirst = <T extends { createdAt: Date }>(rows: readonly T[]) => [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const next = [...oldestFirst(queued.items.filter((t) => t.status === "ready")), ...oldestFirst(queued.items.filter((t) => t.status === "planned"))][0];
  const firstRunning = oldestFirst(running.items)[0];
  const due = roadmap
    .filter((r) => (r.horizon === "now" || r.horizon === "next") && !ROADMAP_FINISHED.has(r.status) && r.targetEnd && r.targetEnd >= today)
    .sort((a, b) => (a.targetEnd! < b.targetEnd! ? -1 : a.targetEnd! > b.targetEnd! ? 1 : 0))[0];
  return {
    today,
    done: { count: finished.length, topItem: top ? { title: titles.get(top[0])!, count: top[1] } : null },
    running: firstRunning ? { title: titleOf(firstRunning) } : null,
    next: next ? { title: titleOf(next) } : null,
    waiting: counts.blocked ?? 0,
    roadmapDue: due ? { title: due.title, dueOn: due.targetEnd! } : null,
    rounds: { completed: cycle.completedCount, running: cycle.running || cycle.queued, runOpen: cycle.run !== null, autopilotNextOn: options.autopilotNextOn ?? null },
  };
}

/** The week's spend, never added across currencies. */
export async function spendFor(tx: DbTx, ctx: BusinessContext, now: Date = new Date()): Promise<TodaySpend> {
  const today = dayKeyIn(now, ctx.business.timeZone);
  const [usage, rows] = await Promise.all([repos.usage.totals(tx, ctx.businessId, { from: new Date(now.getTime() - 7 * 86_400_000), to: now }), repos.channels.metricsRange(tx, ctx.businessId, { from: addDaysToDay(today, -6), to: today })]);
  const own = ctx.business.currency;
  let channelMinor = 0;
  const other = new Map<string, number>();
  for (const r of rows) {
    const currency = r.currency ?? own;
    if (currency === own) channelMinor += Number(r.spendMinor);
    else if (r.spendMinor) other.set(currency, (other.get(currency) ?? 0) + Number(r.spendMinor));
  }
  return {
    aiUsage: { amountMinor: usage.costMinor, currency: CREDITS_CURRENCY },
    channel: { amountMinor: channelMinor, currency: own, otherCurrencies: [...other].map(([currency, amountMinor]) => ({ currency, amountMinor })).sort((a, b) => a.currency.localeCompare(b.currency)) },
  };
}

/**
 * Autopilot's next start as the business's day, when it is on and has one planned. Read before the caller's
 * transaction: the status reads on the service connection (services/autopilot.ts), never inside another transaction.
 */
export async function autopilotNextDay(ctx: BusinessContext): Promise<string | null> {
  if (!ctx.business.autopilotEnabled) return null;
  try {
    const status = await autopilotStatus(ctx);
    return status.state === "on" && status.nextAt ? dayKeyIn(new Date(status.nextAt), ctx.business.timeZone) : null;
  } catch {
    // The week reads without Autopilot's next start rather than failing.
    return null;
  }
}

/** Everything `today.get` returns, as this reader may see it. */
export async function todayView(ctx: BusinessContext, now: Date = new Date()): Promise<TodayView> {
  const m = ctx.membership;
  const week = hasSectionAccess(m, "development", "read");
  const autopilotNextOn = week ? await autopilotNextDay(ctx) : null;
  return ctx.rls(async (tx) => {
    const [needsYou, words, spend, chief] = await Promise.all([
      hasSectionAccess(m, "inbox", "read") ? needsYouFor(tx, ctx) : Promise.resolve(null),
      week ? weekFactsFor(tx, ctx, { now, autopilotNextOn }).then(weekPlanWords) : Promise.resolve(null),
      hasSectionAccess(m, "finance", "read") ? spendFor(tx, ctx, now) : Promise.resolve(null),
      repos.agents.chiefOfStaff(tx, ctx.businessId),
    ]);
    return { today: dayKeyIn(now, ctx.business.timeZone), needsYou, week: words, spend, chiefOfStaff: chief ? { id: chief.id, name: chief.name } : null };
  });
}
