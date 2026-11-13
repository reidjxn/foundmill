/**
 * Today, the business's front door (founder, 2026-11-07): what needs the founder, the week in plain sentences and the
 * week's spend, in one read (`today.get`). The goal itself is `goal.current` / `goal.ensure` (services/goals.ts); the
 * cash, runway and customers figures are the ones every other screen reads (`finance.overview`, `journey.ribbon`).
 *
 * - **Needs you**: the first three notes of the Inbox's Needs you tab, as this reader may read them (the same walls as
 *   `inbox.list`), each with `quickOptionId` only where one tap answers it without the plan compiler: an agent's request
 *   (Approve, when the reader can write the section it touches), a specification or roadmap sign-off (Approve), the
 *   Chief of Staff's goal (Approve this goal) and the page note (Check it and publish, which then opens Product ›
 *   Public page). Everything else opens in the Inbox.
 * - **This week and next**: the sentences of packages/shared today-words.ts from tasks, the roadmap, the round of work
 *   and Autopilot (no model call). Without Development read there are none.
 * - **Spend**: never added across currencies (founder, 2026-11-07). AI usage this week in US dollars (the usage ledger's
 *   USD rows, an Estimate) and channel spend this week in the business's own currency (channel metrics, an Estimate).
 *   Finance read only.
 * - **Public page**: `pageReady` while a project (never a sample business) has no public page live, for a reader with
 *   Product read, and the Product lead's "Your project's page is ready" note is not open (package 1.3: the note while it
 *   is open, in Needs you with its one tap "Check it and publish"; the line otherwise). Today shows one quiet line to
 *   the Public page tab.
 * - **Your first week**: Day 1 asks to publish the page (done the day `project_pages.published_at` is set) and to sign
 *   off the specification and the roadmap.
 */
import { APPROVAL_OPTIONS, approvalSection, repos, type DbTx, type InboxItem, type Task } from "@foundmill/db";
import { CREDITS_CURRENCY } from "@foundmill/config";
import { GOAL_OPTION_IDS, PAGE_READY_NOTE, POSTAL_ADDRESS_NOTE, WRITE_ROLES, addDaysToDay, dailyStreak, dayKeyIn, firstWeekTimeline, firstWeekVisible, hasSectionAccess, isPageReadyDecision, isPostalAddressDecision, vacationDayKeys, weekPlanWords, type FirstWeekWords, type Streak, type WeekFacts, type WeekPlanWords } from "@foundmill/shared";
import { channelRowsFor } from "./channel-availability";
import type { BusinessContext } from "../trpc";
import { autopilotStatus } from "./autopilot";
import { cycleStatus, type CycleStatus } from "./cycle";
import { isProjectFounder } from "./postal-address";
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
  /** "Your first week": null once the business is past it (packages/shared first-week.ts), so an older business reads nothing extra. */
  firstWeek: FirstWeekWords | null;
  /**
   * True while the project has no public page live (0077) and the reader may open the Product area: Today shows one
   * quiet line pointing at the Public page tab. Always false for a sample business.
   */
  pageReady: boolean;
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
  // The page note (package 1.3): one tap answers it and the web opens Product › Public page; nothing is published.
  if (isPageReadyDecision(item.decision)) return { kind: "decision", quickOption: quick(PAGE_READY_NOTE.options.check, hasSectionAccess(ctx.membership, "product", "read")) };
  // The founders' postal address note: one tap answers it and the web opens Settings › Integrations (founders only).
  if (isPostalAddressDecision(item.decision)) return { kind: "decision", quickOption: quick(POSTAL_ADDRESS_NOTE.options.add, isProjectFounder(ctx)) };
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

export const titleOf = (t: Pick<Task, "founderTitle" | "title">): string => (t.founderTitle ?? t.title).trim();
const DONE_LOOKBACK = 200;
const ROADMAP_FINISHED: ReadonlySet<string> = new Set(["done", "shipped", "archived"]);

/** The facts behind "This week and next", in the business's time zone. */
export async function weekFactsFor(tx: DbTx, ctx: BusinessContext, options: { now?: Date; autopilotNextOn?: string | null; cycle?: CycleStatus } = {}): Promise<WeekFacts> {
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
    options.cycle ?? cycleStatus({ db: tx, businessId: ctx.businessId }),
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

/**
 * "Your first week" (founder's report, Phase 3 group K): the timeline from what the business records. A business past
 * its first days, or already selling, answers null from the business row alone (no further read).
 */
export async function firstWeekFor(tx: DbTx, ctx: BusinessContext, now: Date = new Date()): Promise<FirstWeekWords | null> {
  const zone = ctx.business.timeZone;
  const dayOf = (at: Date | null | undefined): string | null => (at ? dayKeyIn(at, zone) : null);
  const base = { today: dayKeyIn(now, zone), createdOn: dayKeyIn(ctx.business.createdAt, zone), distributionStartedOn: dayOf(ctx.business.distributionStartedAt) };
  if (!firstWeekVisible(base)) return null;
  const [signoffs, rounds, goals, channels, page] = await Promise.all([
    repos.productSignoffs.latest(tx, ctx.businessId),
    repos.events.list(tx, ctx.businessId, { type: "cycle.completed", limit: 50 }),
    repos.goals.recent(tx, ctx.businessId, 10),
    channelRowsFor(tx, ctx),
    repos.pages.get(tx, ctx.businessId),
  ]);
  const firstRound = rounds.items.reduce<Date | null>((a, e) => (a === null || e.occurredAt < a ? e.occurredAt : a), null);
  const approvedAt = goals.reduce<Date | null>((a, g) => (g.approvedAt && (a === null || g.approvedAt < a) ? g.approvedAt : a), null);
  return firstWeekTimeline({
    ...base,
    // The page counts once it has gone live (published_at is kept after a take-down: it was published that day).
    pagePublishedOn: dayOf(page?.publishedAt),
    specSignedOffOn: signoffs.spec?.status === "approved" ? (dayOf(signoffs.spec.decidedAt) ?? base.createdOn) : null,
    roadmapSignedOffOn: signoffs.roadmap?.status === "approved" ? (dayOf(signoffs.roadmap.decidedAt) ?? base.createdOn) : null,
    firstRoundOn: dayOf(firstRound),
    goalApprovedOn: dayOf(approvedAt),
    stopped: ctx.business.agentsStoppedAt !== null,
    // Week 1 does not promise an approach no channel can make yet (founder, 2026-11-11).
    noChannelCanRun: channels.available.length === 0,
  });
}

/** Everything `today.get` returns, as this reader may see it. */
export async function todayView(ctx: BusinessContext, now: Date = new Date()): Promise<TodayView> {
  const m = ctx.membership;
  const week = hasSectionAccess(m, "development", "read");
  const autopilotNextOn = week ? await autopilotNextDay(ctx) : null;
  return ctx.rls(async (tx) => {
    const [needsYou, words, spend, chief, firstWeek, pageReady] = await Promise.all([
      hasSectionAccess(m, "inbox", "read") ? needsYouFor(tx, ctx) : Promise.resolve(null),
      week ? weekFactsFor(tx, ctx, { now, autopilotNextOn }).then(weekPlanWords) : Promise.resolve(null),
      hasSectionAccess(m, "finance", "read") ? spendFor(tx, ctx, now) : Promise.resolve(null),
      repos.agents.chiefOfStaff(tx, ctx.businessId),
      firstWeekFor(tx, ctx, now),
      // The quiet "public page" line: never for a sample business, never for a reader walled from Product, and not while
      // the Product lead's "Your project's page is ready" note is open (Needs you shows the note instead: one or the other).
      !ctx.business.isDemo && hasSectionAccess(m, "product", "read")
        ? Promise.all([repos.pages.isUnpublished(tx, ctx.businessId), repos.pages.openReadyNote(tx, ctx.businessId)]).then(([unpublished, note]) => unpublished && note === null)
        : Promise.resolve(false),
    ]);
    return { today: dayKeyIn(now, ctx.business.timeZone), needsYou, week: words, spend, chiefOfStaff: chief ? { id: chief.id, name: chief.name } : null, firstWeek, pageReady };
  });
}

/**
 * "Since you were last here" (retention plan, 2026-11-11): what happened in the business between the end of the
 * founder's previous session (founder_presence.previous_seen_at, kept by the presence ping) and now. Null on a first
 * session, or when nothing happened. Each part follows the reader's section access: the work (development), wins
 * (crm), decisions (inbox), milestones (inbox) and spend (finance, an Estimate).
 */
export interface SinceLastVisit {
  since: string;
  rounds: number;
  tasksDone: number;
  wins: number;
  newDecisions: number;
  milestones: string[];
  /** Model cost of the rounds, an Estimate (null when the reader cannot read Finance). */
  spend: { amountMinor: number; currency: string } | null;
}

export async function sinceLastVisitFor(ctx: BusinessContext, now: Date = new Date()): Promise<SinceLastVisit | null> {
  return sinceVisit(ctx, await ctx.rls((tx) => repos.presence.get(tx, ctx.businessId, ctx.userId)), now);
}

/** "Since you were last here" from the reader's presence row, already read. */
async function sinceVisit(ctx: BusinessContext, presence: { previousSeenAt: string | null } | null, now: Date): Promise<SinceLastVisit | null> {
  if (!presence?.previousSeenAt) return null;
  const since = new Date(presence.previousSeenAt);
  if (since.getTime() >= now.getTime()) return null;
  const can = (s: Parameters<typeof hasSectionAccess>[1]) => hasSectionAccess(ctx.membership, s, "read");
  const itemTypes = [...(can("crm") ? ["customer_won"] : []), ...(can("inbox") ? ["decision"] : [])];
  const [events, items, milestones] = await Promise.all([
    can("development") || can("finance") ? repos.notifyFacts.eventsSince(ctx.db, ctx.businessId, ["cycle.completed"], since) : Promise.resolve([]),
    itemTypes.length ? repos.notifyFacts.itemsSince(ctx.db, ctx.businessId, itemTypes, since) : Promise.resolve([]),
    can("inbox") ? repos.notifyFacts.milestonesSince(ctx.db, ctx.businessId, since) : Promise.resolve([]),
  ]);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const cost = events.reduce((n, e) => n + num((e.payload.cost as { amountMinor?: unknown } | undefined)?.amountMinor), 0);
  const currency = (events.find((e) => (e.payload.cost as { currency?: unknown } | undefined)?.currency)?.payload.cost as { currency: string } | undefined)?.currency ?? "USD";
  const view: SinceLastVisit = {
    since: since.toISOString(),
    rounds: can("development") ? events.length : 0,
    tasksDone: can("development") ? events.reduce((n, e) => n + num(e.payload.tasksCompleted), 0) : 0,
    wins: items.filter((i) => i.type === "customer_won").length,
    newDecisions: items.filter((i) => i.type === "decision" && (i.state === "unread" || i.state === "read")).length,
    milestones: milestones.map((m) => m.label).slice(0, 3),
    spend: can("finance") && cost > 0 ? { amountMinor: cost, currency } : null,
  };
  const nothing = view.rounds === 0 && view.tasksDone === 0 && view.wins === 0 && view.newDecisions === 0 && view.milestones.length === 0;
  return nothing ? null : view;
}

/**
 * The founder's daily streak in this business (retention plan, 2026-11-11; packages/shared streak.ts): days in a row they
 * opened it, vacation days frozen. Their own visit days only (RLS), in the business's calendar. Any member.
 */
export interface TodayVisit {
  sinceLastVisit: SinceLastVisit | null;
  streak: Streak;
}

/**
 * `today.visit`: "Since you were last here" and the daily streak in one read (2026-11-12). Both are the reader's own
 * rows, so they are read in one RLS transaction, where `today.sinceLastVisit` and `today.streak` together open two: the
 * web's Today asks for this one, so its first batch holds one connection less (the api's pool wedge, DECISIONS).
 */
export async function visitFor(ctx: BusinessContext, now: Date = new Date()): Promise<TodayVisit> {
  const zone = ctx.business.timeZone;
  const today = dayKeyIn(now, zone);
  const own = await ctx.rls(async (tx) => ({
    presence: await repos.presence.get(tx, ctx.businessId, ctx.userId),
    visitDays: await repos.presence.visitDays(tx, ctx.businessId, ctx.userId, { from: addDaysToDay(today, -400), to: today }),
  }));
  const [sinceLastVisit, holidays] = await Promise.all([sinceVisit(ctx, own.presence, now), repos.holidays.list(ctx.db, ctx.businessId, 50)]);
  return { sinceLastVisit, streak: dailyStreak({ today, visitDays: own.visitDays, vacationDays: vacationDayKeys(holidays, now, (d) => dayKeyIn(d, zone)) }) };
}

export async function streakFor(ctx: BusinessContext, now: Date = new Date()): Promise<Streak> {
  const zone = ctx.business.timeZone;
  const today = dayKeyIn(now, zone);
  const [visitDays, holidays] = await Promise.all([
    ctx.rls((tx) => repos.presence.visitDays(tx, ctx.businessId, ctx.userId, { from: addDaysToDay(today, -400), to: today })),
    repos.holidays.list(ctx.db, ctx.businessId, 50),
  ]);
  return dailyStreak({ today, visitDays, vacationDays: vacationDayKeys(holidays, now, (d) => dayKeyIn(d, zone)) });
}
