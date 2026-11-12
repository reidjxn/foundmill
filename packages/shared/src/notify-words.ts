/**
 * The words of the retention plan's emails (founder 2026-11-11; one sender since 2026-11-12): a customer won, a milestone,
 * a run the founder started and left finishing, used-up credits, and the morning brief and the Monday weekly review.
 * The gateway (`POST /v1/notify/email`) builds them from its own reads of the database, never from the caller's text, so
 * every piece written by a person or an agent (a note's subject, a name, an option's label) goes through `withoutLinks`
 * and the only links are the email's own, into the app. Every number that is not measured says Estimate. Links carry
 * `?via=email&n=<id>` so the session they start counts as a return from this email. Pure: no Zod, no crypto.
 */
import { countOf, usDate } from "./copy";
import { notificationLinkParams } from "./founder-notifications";
import { formatMoney } from "./money";
import { NOTIFY_NO_REPLY_LINE, withoutLinks, type NotifyEmailText } from "./notify-email";

/** The note fields the words read (packages/db `NotifyItem` has them). */
export interface NotifyItemLike {
  id: string;
  type: string;
  subject: string;
  createdAt: Date;
  state: string;
  decision: Record<string, unknown> | null;
  blocksContinue: boolean;
}

export interface NotifyEventLike {
  id: string;
  type: string;
  occurredAt: Date;
  actor: { kind: string; id: string };
  payload: Record<string, unknown>;
}

export interface RunEndFact {
  runId: string;
  endedAt: Date;
  reason: string;
  rounds: number;
  costMinor: number;
  currency: string;
  startedBy: string | null;
  startedAt: Date | null;
}

export interface MilestoneFact {
  id: string;
  label: string;
  achievedAt: Date;
}

/** What one business holds for the notifier (packages/db `loadNotifyFacts`). */
export interface BusinessNotifyFacts {
  businessId: string;
  name: string;
  timeZone: string | null;
  now: Date;
  openDecisions: NotifyItemLike[];
  /** Wins, milestone notes and warnings of the last 7 days. */
  recentItems: NotifyItemLike[];
  milestones: MilestoneFact[];
  runEnds: RunEndFact[];
  /** cycle.completed events of the last 7 days. */
  cycles: NotifyEventLike[];
}

export interface BriefStats {
  since: Date;
  rounds: number;
  tasksDone: number;
  costMinor: number;
  costCurrency: string;
  wins: NotifyItemLike[];
  milestones: MilestoneFact[];
}

/** The subjects of the used-up-credits warning (packages/db billing.ts). */
export const CREDITS_SUBJECTS: readonly string[] = ["Credits used up: team paused", "Credits used up: conversations and Refresh paused"];

export type RetentionEmailPlan =
  | { kind: "win"; item: NotifyItemLike }
  | { kind: "milestone"; label: string; itemId: string | null }
  | { kind: "run_finished"; run: RunEndFact; tasksDone: number; waiting: NotifyItemLike[] }
  | { kind: "credits"; item: NotifyItemLike }
  | { kind: "daily_brief" | "weekly_review"; day: string; stats: BriefStats; waiting: NotifyItemLike[] };

const ms = (d: Date) => d.getTime();
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function briefStats(b: Pick<BusinessNotifyFacts, "cycles" | "recentItems" | "milestones">, since: Date): BriefStats {
  const cycles = b.cycles.filter((e) => ms(e.occurredAt) >= ms(since));
  const cost = cycles.reduce((n, e) => n + num((e.payload.cost as { amountMinor?: unknown } | undefined)?.amountMinor), 0);
  const currency = (cycles.find((e) => typeof (e.payload.cost as { currency?: unknown } | undefined)?.currency === "string")?.payload.cost as { currency: string } | undefined)?.currency ?? "USD";
  return {
    since,
    rounds: cycles.length,
    tasksDone: cycles.reduce((n, e) => n + num(e.payload.tasksCompleted), 0),
    costMinor: cost,
    costCurrency: currency,
    wins: b.recentItems.filter((i) => i.type === "customer_won" && ms(i.createdAt) >= ms(since)),
    milestones: b.milestones.filter((m) => ms(m.achievedAt) >= ms(since)),
  };
}

/** True when nothing happened and nothing waits: the brief would have no news, so it is not sent. */
export function briefIsEmpty(stats: BriefStats, waiting: readonly NotifyItemLike[]): boolean {
  return stats.rounds === 0 && stats.tasksDone === 0 && stats.wins.length === 0 && stats.milestones.length === 0 && waiting.length === 0;
}

/** Tasks the cycles of a run finished (those between its start and its end). */
export function runTasksDone(cycles: readonly NotifyEventLike[], run: Pick<RunEndFact, "startedAt" | "endedAt">): number {
  return cycles.filter((e) => ms(e.occurredAt) <= ms(run.endedAt) && (run.startedAt === null || ms(e.occurredAt) >= ms(run.startedAt))).reduce((n, e) => n + num(e.payload.tasksCompleted), 0);
}

export interface RetentionEmailContext {
  appUrl: string;
  appName: string;
  businessId: string;
  businessName: string;
  notificationId: string;
  recipientName: string | null;
  /** The signed link that turns this kind of email off (the List-Unsubscribe header too). */
  offLink: string;
  /** The signed link that pauses every email. */
  pauseLink: string;
  /**
   * The recipient is walled from Customers or Money: note subjects can name customers and amounts, so the email says what
   * kind of thing happened and the founder reads the rest in the app, where the walls apply.
   */
  hideSubjects?: boolean;
  /** The founder's daily streak (briefs only). */
  streak?: { current: number; visitedToday: boolean } | null;
  /** A one-click answer for the first waiting decision, when it qualifies. */
  oneClick: { itemId: string; label: string; consequence: string; url: string } | null;
}

const oneLine = (value: string, max: number): string => {
  const v = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
};

/** Text written by a person or an agent, as an email from Foundmill may show it: no markup, no links, one line. */
export function safeText(text: string, max = 200): string {
  return oneLine(
    withoutLinks(
      text
        .replace(/\[\[ent:[^|\]]+\|([^\]]+)\]\]/g, "$1")
        .replace(/^>\s*/gm, "")
        .replace(/[*_`#]/g, ""),
    ),
    max,
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface Block {
  kind: "p" | "list" | "button";
  text?: string;
  items?: { text: string; href?: string }[];
  href?: string;
}

function link(ctx: RetentionEmailContext, path: string): string {
  const url = new URL(path, ctx.appUrl);
  for (const [k, v] of new URLSearchParams(notificationLinkParams(ctx.notificationId))) url.searchParams.set(k, v);
  return url.toString();
}

const inboxLink = (ctx: RetentionEmailContext, itemId?: string) => link(ctx, `/b/${ctx.businessId}/inbox${itemId ? `/${itemId}` : ""}`);
const todayLink = (ctx: RetentionEmailContext) => link(ctx, `/b/${ctx.businessId}/today`);

function subjectOf(ctx: RetentionEmailContext, item: Pick<NotifyItemLike, "subject" | "type">): string {
  if (!ctx.hideSubjects) return safeText(item.subject);
  return item.type === "customer_won" ? "A customer paid" : item.type === "decision" ? "A decision for you" : "A note from your team";
}

function waitingList(ctx: RetentionEmailContext, items: readonly NotifyItemLike[]): Block {
  return { kind: "list", items: items.slice(0, 5).map((i) => ({ text: subjectOf(ctx, i), href: inboxLink(ctx, i.id) })) };
}

function oneClickBlocks(ctx: RetentionEmailContext): Block[] {
  if (!ctx.oneClick) return [];
  const consequence = safeText(ctx.oneClick.consequence, 300);
  return [
    { kind: "button", text: `Answer “${safeText(ctx.oneClick.label, 80)}”`, href: ctx.oneClick.url },
    { kind: "p", text: `This is the recommended answer and can be changed later${consequence ? `: ${consequence}` : "."}` },
  ];
}

function streakBlocks(ctx: RetentionEmailContext, name: string): Block[] {
  const s = ctx.streak;
  if (!s || s.current < 2) return [];
  return [{ kind: "p", text: s.visitedToday ? `You have opened ${name} ${s.current} days in a row.` : `You are on a ${s.current}-day streak. Open Today to make it ${s.current + 1}.` }];
}

const spend = (minor: number, currency: string) => `${formatMoney({ amountMinor: minor, currency })} (Estimate)`;

function compose(plan: RetentionEmailPlan, ctx: RetentionEmailContext): { subject: string; blocks: Block[] } {
  const name = safeText(ctx.businessName, 120);
  switch (plan.kind) {
    case "win":
      return {
        subject: `${name} won a customer`,
        blocks: [
          { kind: "p", text: subjectOf(ctx, plan.item) },
          { kind: "p", text: "See who was involved and how they found you in the Customer Update." },
          { kind: "button", text: "Open the Customer Update", href: inboxLink(ctx, plan.item.id) },
        ],
      };
    case "milestone": {
      const label = ctx.hideSubjects ? null : safeText(plan.label, 120);
      return {
        subject: label ? `${name} reached a milestone: ${label}` : `${name} reached a milestone`,
        blocks: [
          { kind: "p", text: `${label ?? "A new milestone"}. It is on your milestones page for good.` },
          { kind: "button", text: plan.itemId ? "Open the note" : "See your milestones", href: plan.itemId ? inboxLink(ctx, plan.itemId) : link(ctx, `/b/${ctx.businessId}/milestones`) },
        ],
      };
    }
    case "run_finished": {
      const r = plan.run;
      const lines = [`${countOf(r.rounds, "round")} of work finished`, `${countOf(plan.tasksDone, "task")} done`, `team spend ${spend(r.costMinor, r.currency)}`];
      return {
        subject: `${name}: your team finished (${countOf(plan.tasksDone, "task")} done)`,
        blocks: [
          { kind: "p", text: `The run you started ${r.startedAt ? `on ${usDate(r.startedAt, { year: false })} ` : ""}has finished: ${lines.join(", ")}.` },
          ...(plan.waiting.length ? [{ kind: "p" as const, text: `${countOf(plan.waiting.length, "decision")} ${plan.waiting.length === 1 ? "waits" : "wait"} for you:` }, waitingList(ctx, plan.waiting), ...oneClickBlocks(ctx)] : []),
          { kind: "button", text: "See what the team did", href: todayLink(ctx) },
        ],
      };
    }
    case "credits":
      return {
        subject: `${name}: the team paused because the credits are used up`,
        blocks: [
          { kind: "p", text: "Nothing is lost: tasks pick up where they stopped. Top up in Settings › Billing, or add your own Anthropic key in Settings › Keys, and the team resumes by itself." },
          { kind: "button", text: "Open Billing", href: link(ctx, `/b/${ctx.businessId}/settings/billing`) },
        ],
      };
    case "daily_brief":
    case "weekly_review": {
      const s = plan.stats;
      const weekly = plan.kind === "weekly_review";
      const facts: string[] = [];
      if (s.rounds > 0 || s.tasksDone > 0) facts.push(`${countOf(s.rounds, "round")} of work, ${countOf(s.tasksDone, "task")} done`);
      if (s.wins.length > 0) facts.push(`${countOf(s.wins.length, "customer")} won`);
      for (const m of s.milestones.slice(0, 3)) facts.push(ctx.hideSubjects ? "A new milestone" : `Milestone: ${safeText(m.label, 120)}`);
      if (s.costMinor > 0) facts.push(`Team spend ${spend(s.costMinor, s.costCurrency)}`);
      const lead = s.wins.length > 0 ? `${countOf(s.wins.length, "customer")} won` : plan.waiting.length > 0 ? `${countOf(plan.waiting.length, "decision")} ${plan.waiting.length === 1 ? "needs" : "need"} you` : `${countOf(s.tasksDone, "task")} done`;
      const greeting = ctx.recipientName ? `Good morning, ${safeText(ctx.recipientName, 60)}.` : "Good morning.";
      return {
        subject: weekly ? `${name}: your week, ${lead}` : `${name}: ${lead} since yesterday`,
        blocks: [
          { kind: "p", text: `${greeting} ${weekly ? `Here is ${name}'s week since ${usDate(s.since, { year: false })}.` : `Here is what happened at ${name} since yesterday morning.`}` },
          ...(facts.length ? [{ kind: "list" as const, items: facts.map((text) => ({ text })) }] : [{ kind: "p" as const, text: "The team did not run any work in this time." }]),
          ...(plan.waiting.length ? [{ kind: "p" as const, text: plan.waiting.length === 1 ? "One thing needs you:" : `${countOf(plan.waiting.length, "thing")} need you:` }, waitingList(ctx, plan.waiting), ...oneClickBlocks(ctx)] : [{ kind: "p" as const, text: "Nothing needs you right now." }]),
          ...streakBlocks(ctx, name),
          { kind: "button", text: "Open Today", href: todayLink(ctx) },
        ],
      };
    }
  }
}

function footer(ctx: RetentionEmailContext): { text: string; html: string } {
  const settings = link(ctx, `/b/${ctx.businessId}/settings/preferences`);
  const why = `You get this because you are part of ${safeText(ctx.businessName, 120)} on ${ctx.appName}.`;
  return {
    text: `${NOTIFY_NO_REPLY_LINE}\n\n--\n${why}\nChoose which emails you get: ${settings}\nTurn these emails off: ${ctx.offLink}\nPause every email: ${ctx.pauseLink}`,
    html: `<p style="margin:0 0 12px;font-size:14px;line-height:22px">${esc(NOTIFY_NO_REPLY_LINE)}</p><hr><p style="color:#6b7280;font-size:12px;line-height:18px;margin:12px 0 0">${esc(why)} <a href="${esc(settings)}" style="color:#6b7280">Choose which emails you get</a> · <a href="${esc(ctx.offLink)}" style="color:#6b7280">Turn these emails off</a> · <a href="${esc(ctx.pauseLink)}" style="color:#6b7280">Pause every email</a></p>`,
  };
}

/** The email for a retention-plan kind, in plain text and simple HTML. */
export function retentionEmail(plan: RetentionEmailPlan, ctx: RetentionEmailContext): NotifyEmailText {
  const { subject, blocks } = compose(plan, ctx);
  const text: string[] = [];
  const html: string[] = [];
  for (const b of blocks) {
    if (b.kind === "p") {
      text.push(b.text!);
      html.push(`<p style="margin:0 0 12px;font-size:14px;line-height:22px">${esc(b.text!)}</p>`);
    } else if (b.kind === "list") {
      text.push(b.items!.map((i) => `- ${i.text}${i.href ? `\n  ${i.href}` : ""}`).join("\n"));
      html.push(`<ul style="margin:0 0 12px;padding-left:20px;font-size:14px;line-height:22px">${b.items!.map((i) => `<li>${i.href ? `<a href="${esc(i.href)}" style="color:#1b4fd8">${esc(i.text)}</a>` : esc(i.text)}</li>`).join("")}</ul>`);
    } else {
      text.push(`${b.text}: ${b.href}`);
      html.push(`<p style="margin:16px 0"><a href="${esc(b.href!)}" style="background:#1b4fd8;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">${esc(b.text!)}</a></p>`);
    }
  }
  const f = footer(ctx);
  return {
    subject: subject.slice(0, 200),
    text: `${text.join("\n\n")}\n\n${f.text}\n`,
    html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#111827;max-width:560px">${html.join("")}${f.html}</div>`,
  };
}
