/**
 * The morning brief, as one page in four short sections (item 10, Nov 13, 2026): what worked, what's booked, what's
 * waiting on you, what's next. Pure: the gateway reads the facts (packages/db `loadBriefFacts`, `loadNotifyFacts`) and
 * the person's walls, this builds the sections, and `retentionEmail` (notify-words.ts) lays them out. A template, never
 * a model call (DECISIONS 2026-11-11: every line is a fact from the database).
 *
 * **What worked counts real outcomes only** (CLAUDE.md north star): a public page live, an email that left from the
 * project's address, a person who confirmed they want to follow the project, a payment a vendor delivered, a reply from
 * a person. A simulated result never appears there: an event the Simulate panel wrote (`system:simulate`), a payload
 * that says `simulated` (or does not say it is not, for `mail.sent`), and a payment or a reply that did not arrive from a
 * vendor's delivery (actor `webhook`) are left out. Unsubscribes, spam reports, out-of-office and negative replies are
 * real but did not work, so they are not listed. The team's own work (rounds, tasks, spend) is said once, apart, as
 * "behind the scenes", never as an outcome.
 *
 * A quiet stretch reads as quiet, never as failure; a project of one person reads complete (nothing names anyone who is
 * not there). US English and US dates ("Wed, Nov 18", "3:45 PM"), in the person's zone (else the business's).
 */
import { countOf } from "./copy";
import { CHANNEL_META, type ChannelKey } from "./constants";
import { addDaysToKey } from "./founder-return";
import { formatMoney } from "./money";
import type { PostNetwork } from "./post-draft";
import { viaPostWords } from "./post-outcomes";
import { withoutLinks } from "./notify-email";
import type { Section } from "./permissions";
import { businessTimeZone, dayKeyIn } from "./time-zone";

/** The event fields the brief reads (packages/db `NotifyEvent` has them). */
export interface BriefEventLike {
  id: string;
  type: string;
  occurredAt: Date;
  actor: { kind: string; id: string };
  payload: Record<string, unknown>;
}

/** The note fields the brief reads (packages/db `NotifyItem` has them). */
export interface BriefItemLike {
  id: string;
  type: string;
  subject: string;
}

/** Events that can be a real outcome of the project (the north star's list, as the catalog declares them). */
export const REAL_OUTCOME_EVENT_TYPES = ["page.published", "mail.sent", "page.followed", "payment.received", "lead.replied"] as const;
/** Read beside them only for what caused a payment (the journey's lead channel). */
export const BRIEF_CAUSE_EVENT_TYPES = ["customer.converted"] as const;
export const BRIEF_EVENT_TYPES: readonly string[] = [...REAL_OUTCOME_EVENT_TYPES, ...BRIEF_CAUSE_EVENT_TYPES];

/** Replies that read as "it worked": a person answered. Unsubscribes, spam reports, auto-replies and refusals do not. */
const REPLIES_THAT_WORKED: ReadonlySet<string> = new Set(["positive", "neutral"]);

/** True for anything the Simulate panel or a mock produced: it never counts as an outcome. */
export function isSimulatedEvent(e: Pick<BriefEventLike, "actor" | "payload">): boolean {
  if (e.actor.kind === "system" && e.actor.id === "simulate") return true;
  return "simulated" in e.payload && e.payload.simulated !== false;
}

/**
 * True when one event is a real outcome of the project: one of REAL_OUTCOME_EVENT_TYPES, not simulated, and written by
 * the source that makes it real. `realOutcomes()` and the nightly numbers' SQL (packages/db `repos.metrics`) apply
 * exactly this rule.
 */
export function isRealOutcome(e: Pick<BriefEventLike, "type" | "actor" | "payload">): boolean {
  if (isSimulatedEvent(e)) return false;
  const p = e.payload;
  switch (e.type) {
    case "page.published":
      // The founder publishes the page themselves (the event's actor is the person).
      return e.actor.kind === "user";
    case "mail.sent":
      // Only a message the vendor accepted for real: the gateway writes `simulated: false` then, and only then.
      return p.simulated === false;
    case "page.followed":
      // Written once, when the person confirmed from their own inbox (double opt-in).
      return e.actor.kind === "system" && e.actor.id === "public-page";
    case "payment.received":
      return e.actor.kind === "webhook";
    case "lead.replied":
      return e.actor.kind === "webhook" && typeof p.sentiment === "string" && REPLIES_THAT_WORKED.has(p.sentiment);
    default:
      return false;
  }
}

/**
 * The shared team post a real outcome came through (item 8; packages/db `postAttributions.viaPostFor`): the network
 * (null for a copied or sent link) and the day its share was opened. Only a follow, a reply or a payment the platform
 * credited to a post carries one; it says nothing about the person, and it is behind the outcome's own wall.
 */
export interface ViaPost {
  network: PostNetwork | null;
  sharedAt: Date;
}

export type RealOutcome =
  | { kind: "page_live"; at: Date; byUserId: string | null }
  | { kind: "email_sent"; at: Date; agentId: string | null; channelKey: string | null }
  | { kind: "follower"; at: Date; viaPost?: ViaPost }
  | { kind: "payment"; at: Date; amountMinor: number; currency: string; firstPayment: boolean; channelKey: string | null; viaPost?: ViaPost }
  | { kind: "reply"; at: Date; channelKey: string | null; requestsMeeting: boolean; viaPost?: ViaPost };
export type RealOutcomeKind = RealOutcome["kind"];

/** The section a reader must be able to read to see an outcome of this kind (the gateway applies it). */
export const OUTCOME_SECTION: Readonly<Record<RealOutcomeKind, Section>> = { page_live: "product", email_sent: "distribution", follower: "crm", payment: "finance", reply: "crm" };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * The real outcomes among `events` that happened in [since, now], oldest first; everything simulated left out. A follow,
 * a reply or a payment whose event `viaPosts` names (by event id) carries the post it came through.
 */
export function realOutcomes(events: readonly BriefEventLike[], since: Date, now: Date, viaPosts?: ReadonlyMap<string, ViaPost>): RealOutcome[] {
  const via = (e: BriefEventLike): { viaPost?: ViaPost } => {
    const v = viaPosts?.get(e.id);
    return v ? { viaPost: v } : {};
  };
  const inWindow = (e: BriefEventLike) => e.occurredAt.getTime() >= since.getTime() && e.occurredAt.getTime() <= now.getTime();
  const leadChannel = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "customer.converted" || isSimulatedEvent(e)) continue;
    const id = str(e.payload.conversionId);
    const channel = str(e.payload.captainChannelKey);
    if (id && channel) leadChannel.set(id, channel);
  }
  const out: RealOutcome[] = [];
  for (const e of [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())) {
    if (!inWindow(e) || !isRealOutcome(e)) continue;
    const p = e.payload;
    switch (e.type) {
      case "page.published":
        out.push({ kind: "page_live", at: e.occurredAt, byUserId: e.actor.id });
        break;
      case "mail.sent":
        out.push({ kind: "email_sent", at: e.occurredAt, agentId: str(p.agentId), channelKey: str(p.channelKey) });
        break;
      case "page.followed":
        out.push({ kind: "follower", at: e.occurredAt, ...via(e) });
        break;
      case "payment.received": {
        const amount = (p.amount ?? {}) as { amountMinor?: unknown; currency?: unknown };
        const conversionId = str(p.conversionId);
        out.push({ kind: "payment", at: e.occurredAt, amountMinor: typeof amount.amountMinor === "number" ? amount.amountMinor : 0, currency: str(amount.currency) ?? "USD", firstPayment: p.firstPayment === true, channelKey: conversionId ? (leadChannel.get(conversionId) ?? null) : null, ...via(e) });
        break;
      }
      case "lead.replied":
        out.push({ kind: "reply", at: e.occurredAt, channelKey: str(p.channelKey), requestsMeeting: p.requestsMeeting === true, ...via(e) });
        break;
    }
  }
  return out;
}

/** Something on the calendar: a scheduled campaign, a filing or a compliance date, the goal's date, a roadmap end. */
export interface BookedFact {
  kind: "campaign" | "filing" | "compliance" | "goal" | "roadmap";
  title: string;
  /** An instant (a campaign's start, a filing's due time). */
  at: Date | null;
  /** A calendar day ("2026-11-20"), for the goal and the roadmap. */
  day: string | null;
}

/** The section a reader must be able to read to see a booked fact of this kind; null: any member. */
export const BOOKED_SECTION: Readonly<Record<BookedFact["kind"], Section | null>> = { campaign: "distribution", filing: "legal", compliance: "legal", goal: null, roadmap: "product" };

/** How far ahead "What's booked" looks, and what counts as news on its own (today and tomorrow). */
export const BRIEF_BOOKED_DAYS = 14;
const BOOKED_NEWS_DAYS = 1;

/** What the team will do today (Development read): running and queued tasks, Autopilot's next start, a stop. */
export interface NextFacts {
  running: string[];
  queued: string[];
  /** Autopilot's next planned start, when it is on and not paused. */
  autopilotNextAt: Date | null;
  /** The founder stopped the agents (Stop all agents). */
  stopped: boolean;
}

export interface MorningBriefInput {
  weekly: boolean;
  now: Date;
  /** The start of the window: the last brief, a day back at most a week ago (a week for the weekly review). */
  since: Date;
  /** The person's zone, else the business's; null reads UTC. */
  timeZone: string | null;
  /** Real outcomes as this person may see them (`realOutcomes`, then the walls). */
  outcomes: readonly RealOutcome[];
  /** The team's own work in the window. */
  work: { rounds: number; tasksDone: number; costMinor: number; costCurrency: string };
  /** Notes that wait for an answer, oldest first. */
  waiting: readonly BriefItemLike[];
  booked: readonly BookedFact[];
  /** Null: the person cannot read Development, so the section is left out. */
  next: NextFacts | null;
  /** Agent names as this person names agents, by id. */
  agentNames?: Readonly<Record<string, string>>;
  recipientUserId?: string | null;
  /** Walled from Money or Customers: no amounts. */
  hideAmounts?: boolean;
  /**
   * The window's effort as one sentence of counted records (WP-14 T5, ./effort `effortSentence`): "Your team ran 14
   * quality checks and read 3 sources." Null or absent: nothing was counted, or the person cannot read Development.
   */
  effort?: string | null;
}

export interface BriefLine {
  text: string;
  /** What caused it, when known ("sent by Rhea", "found through SEO"). */
  cause: string | null;
}

export interface MorningBrief {
  /** "since yesterday", "since Nov 9", "since Nov 6" (weekly). */
  sinceWords: string;
  worked: { lines: BriefLine[]; empty: string | null };
  /** Empty: the section is left out. */
  booked: BriefLine[];
  waiting: { count: number; items: BriefItemLike[]; intro: string; empty: string | null };
  /** Null: left out (no Development read). */
  next: { lines: string[]; empty: string | null } | null;
  /** The team's own work, said apart from the outcomes; null when it did none. */
  behindTheScenes: string | null;
  /** The subject's few words: "a payment came in", "2 things need you". */
  lead: string;
  /** False: nothing happened, nothing waits and nothing is due today or tomorrow, so the brief is not sent. */
  hasNews: boolean;
}

/** At most this many lines in a section; the rest is one tap away in the app. */
export const BRIEF_SECTION_MAX = 5;

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

const channelLabel = (key: string | null): string | null => (key && key in CHANNEL_META ? CHANNEL_META[key as ChannelKey].label : null);

/** "Wed, Nov 18" for a calendar day key. */
export function briefDayWords(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "today", "tomorrow" or "Wed, Nov 18", as the person's calendar has it. */
function relativeDay(day: string, today: string): string {
  if (day === today) return "today";
  if (day === addDaysToKey(today, 1)) return "tomorrow";
  return briefDayWords(day);
}

/** "today at 3:45 PM", "tomorrow at 9:00 AM", "Wed, Nov 18 at 3:45 PM", in the zone. */
export function briefWhenWords(at: Date, timeZone: string | null, now: Date): string {
  const zone = businessTimeZone(timeZone);
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone });
  return `${relativeDay(dayKeyIn(at, zone), dayKeyIn(now, zone))} at ${time}`;
}

/** "Nov 9" for an instant, in the zone. */
function shortDate(at: Date, timeZone: string | null): string {
  return new Date(`${dayKeyIn(at, timeZone)}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function sinceWordsOf(input: Pick<MorningBriefInput, "weekly" | "now" | "since" | "timeZone">): string {
  const hours = (input.now.getTime() - input.since.getTime()) / 3_600_000;
  if (!input.weekly && hours <= 30) return "since yesterday";
  return `since ${shortDate(input.since, input.timeZone)}`;
}

/** "from your post on X, Nov 12": the cause a post-credited outcome carries, in the business's zone. */
const postCause = (v: ViaPost, timeZone: string | null): string => viaPostWords({ network: v.network, sharedAt: v.sharedAt, timeZone: businessTimeZone(timeZone) });

/** Outcomes grouped by the post words that caused them, in first-seen order; the ones no post caused under null. */
function byPost<T extends { viaPost?: ViaPost }>(rows: readonly T[], timeZone: string | null): [string | null, T[]][] {
  const groups = new Map<string | null, T[]>();
  for (const r of rows) {
    const key = r.viaPost ? postCause(r.viaPost, timeZone) : null;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups];
}

function workedLines(input: MorningBriefInput): BriefLine[] {
  const o = input.outcomes;
  const lines: BriefLine[] = [];
  const money = (minor: number, currency: string) => formatMoney({ amountMinor: minor, currency });
  for (const p of o.filter((x): x is Extract<RealOutcome, { kind: "payment" }> => x.kind === "payment").slice(0, 3)) {
    const amount = input.hideAmounts || p.amountMinor <= 0 ? null : money(p.amountMinor, p.currency);
    const text = p.firstPayment ? `A new customer paid${amount ? ` ${amount}` : ""}` : `A payment came in${amount ? `: ${amount}` : ""}`;
    const channel = channelLabel(p.channelKey);
    lines.push({ text, cause: p.viaPost ? postCause(p.viaPost, input.timeZone) : channel ? `found you through ${channel}` : null });
  }
  const morePayments = o.filter((x) => x.kind === "payment").length - 3;
  if (morePayments > 0) lines.push({ text: `${countOf(morePayments, "more payment")} came in`, cause: null });

  // Replies and follows a shared post brought get a line per post, with the post as the cause (item 8).
  for (const [post, replies] of byPost(o.filter((x): x is Extract<RealOutcome, { kind: "reply" }> => x.kind === "reply"), input.timeZone)) {
    const talk = replies.filter((r) => r.requestsMeeting).length;
    const channels = [...new Set(replies.map((r) => channelLabel(r.channelKey)).filter((c): c is string => !!c))];
    lines.push({ text: `${replies.length === 1 ? "A person replied" : `${replies.length.toLocaleString("en-US")} people replied`} to the team's outreach${talk > 0 ? `${replies.length === 1 ? " and asked to talk" : `, ${talk.toLocaleString("en-US")} asking to talk`}` : ""}`, cause: post ?? (channels.length ? `through ${channels.slice(0, 2).join(" and ")}` : null) });
  }

  for (const [post, group] of byPost(o.filter((x): x is Extract<RealOutcome, { kind: "follower" }> => x.kind === "follower"), input.timeZone)) {
    const followers = group.length;
    lines.push({ text: followers === 1 ? "A person chose to follow your project" : `${followers.toLocaleString("en-US")} people chose to follow your project`, cause: post ?? "they signed up on your public page and confirmed by email" });
  }

  const pages = o.filter((x): x is Extract<RealOutcome, { kind: "page_live" }> => x.kind === "page_live");
  if (pages.length > 0) {
    const byYou = input.recipientUserId ? pages.some((p) => p.byUserId === input.recipientUserId) : false;
    lines.push({ text: pages.length === 1 ? "Your public page went live" : `Your public page went live with ${countOf(pages.length - 1, "more update")}`, cause: byYou ? "you published it" : null });
  }

  const emails = o.filter((x): x is Extract<RealOutcome, { kind: "email_sent" }> => x.kind === "email_sent");
  if (emails.length > 0) {
    // One line per sender: who sent them is what caused them.
    const byAgent = new Map<string | null, typeof emails>();
    for (const e of emails) byAgent.set(e.agentId, [...(byAgent.get(e.agentId) ?? []), e]);
    for (const [agentId, group] of [...byAgent].sort((a, b) => b[1].length - a[1].length).slice(0, 2)) {
      const name = agentId ? input.agentNames?.[agentId] : undefined;
      const channel = channelLabel(group.find((g) => g.channelKey)?.channelKey ?? null);
      const cause = name ? `sent by ${safeText(name, 60)}${channel ? ` for ${channel}` : ""}` : channel ? `for ${channel}` : null;
      lines.push({ text: `${countOf(group.length, "email")} went out from your project's address`, cause });
    }
  }
  return lines.slice(0, BRIEF_SECTION_MAX);
}

function bookedLines(input: MorningBriefInput): BriefLine[] {
  const today = dayKeyIn(input.now, input.timeZone);
  const until = addDaysToKey(today, BRIEF_BOOKED_DAYS);
  const dayOf = (b: BookedFact) => b.day ?? (b.at ? dayKeyIn(b.at, input.timeZone) : null);
  const rows = input.booked
    .map((b) => ({ b, day: dayOf(b) }))
    .filter((r): r is { b: BookedFact; day: string } => r.day !== null && r.day >= today && r.day <= until)
    .sort((x, y) => (x.b.at?.getTime() ?? Date.parse(`${x.day}T23:59:59Z`)) - (y.b.at?.getTime() ?? Date.parse(`${y.day}T23:59:59Z`)));
  return rows.slice(0, BRIEF_SECTION_MAX).map(({ b, day }) => {
    const title = safeText(b.title, 120);
    switch (b.kind) {
      case "campaign":
        return { text: `“${title}” starts ${b.at ? briefWhenWords(b.at, input.timeZone, input.now) : relativeDay(day, today)}`, cause: null };
      case "filing":
        return { text: `Filing due ${relativeDay(day, today)}: ${title}`, cause: null };
      case "compliance":
        return { text: `Due ${relativeDay(day, today)}: ${title}`, cause: null };
      case "goal":
        return { text: `Your goal's date is ${relativeDay(day, today)}: ${title}`, cause: null };
      case "roadmap":
        return { text: `Planned to be done ${relativeDay(day, today)}: ${title}`, cause: null };
    }
  });
}

function nextOf(input: MorningBriefInput): MorningBrief["next"] {
  const n = input.next;
  if (!n) return null;
  if (n.stopped) return { lines: [], empty: "The team is stopped for now. It picks up where it left off when you resume the agents." };
  const lines = [...n.running.slice(0, 2).map((t) => `Working on: ${safeText(t, 120)}`), ...n.queued.slice(0, 3).map((t) => `Up next: ${safeText(t, 120)}`)];
  if (n.autopilotNextAt && n.autopilotNextAt.getTime() >= input.now.getTime()) lines.push(`Autopilot starts the next round of work ${briefWhenWords(n.autopilotNextAt, input.timeZone, input.now)}.`);
  return { lines: lines.slice(0, BRIEF_SECTION_MAX), empty: lines.length ? null : "Nothing is queued yet. Press Continue on Today when you want the team to plan the next steps." };
}

function leadOf(input: MorningBriefInput, booked: number): string {
  const count = (k: RealOutcomeKind) => input.outcomes.filter((o) => o.kind === k).length;
  const payments = count("payment");
  if (payments > 0) return payments === 1 ? "a payment came in" : `${payments.toLocaleString("en-US")} payments came in`;
  const replies = count("reply");
  if (replies > 0) return replies === 1 ? "a person replied" : `${replies.toLocaleString("en-US")} people replied`;
  const followers = count("follower");
  if (followers > 0) return followers === 1 ? "a new follower" : `${followers.toLocaleString("en-US")} new followers`;
  if (count("page_live") > 0) return "your page went live";
  const emails = count("email_sent");
  if (emails > 0) return `${countOf(emails, "email")} went out`;
  if (input.waiting.length > 0) return input.waiting.length === 1 ? "1 thing needs you" : `${input.waiting.length.toLocaleString("en-US")} things need you`;
  if (booked > 0) return booked === 1 ? "1 thing coming up" : `${booked.toLocaleString("en-US")} things coming up`;
  if (input.work.tasksDone > 0) return `${countOf(input.work.tasksDone, "task")} done`;
  return input.weekly ? "your week" : "your morning brief";
}

/** The four sections, and whether the brief has anything to say at all. */
export function morningBrief(input: MorningBriefInput): MorningBrief {
  const sinceWords = sinceWordsOf(input);
  const worked = workedLines(input);
  const booked = bookedLines(input);
  const today = dayKeyIn(input.now, input.timeZone);
  const soon = addDaysToKey(today, BOOKED_NEWS_DAYS);
  const bookedSoon = input.booked.filter((b) => {
    const day = b.day ?? (b.at ? dayKeyIn(b.at, input.timeZone) : null);
    return day !== null && day >= today && day <= soon;
  }).length;
  const w = input.work;
  const spend = !input.hideAmounts && w.costMinor > 0 ? `, team spend ${formatMoney({ amountMinor: w.costMinor, currency: w.costCurrency })} (Estimate)` : "";
  const workLine = w.rounds > 0 || w.tasksDone > 0 ? `Behind the scenes: ${countOf(w.rounds, "round")} of work, ${countOf(w.tasksDone, "task")} done${spend}.` : null;
  // Effort beside the results (WP-14 T5): counted records only, said after the rounds and tasks, or alone.
  const behindTheScenes = [workLine, input.effort ?? null].filter((s): s is string => !!s).join(" ") || null;
  const waiting = input.waiting.slice(0, BRIEF_SECTION_MAX);
  const count = input.waiting.length;
  return {
    sinceWords,
    worked: { lines: worked, empty: worked.length ? null : `A quiet stretch: nothing new went out ${sinceWords}.` },
    booked,
    waiting: { count, items: waiting, intro: count === 1 ? "1 thing needs you:" : `${count.toLocaleString("en-US")} things need you${count > waiting.length ? `; here are the first ${waiting.length}` : ""}:`, empty: count ? null : "Nothing needs you right now." },
    next: nextOf(input),
    behindTheScenes,
    lead: leadOf(input, booked.length),
    hasNews: input.outcomes.length > 0 || w.rounds > 0 || w.tasksDone > 0 || count > 0 || bookedSoon > 0,
  };
}
