"use client";
/**
 * Live feed widget (BUILD §11.2): platform events as they arrive on `ev:<businessId>`, newest first. Seeded from
 * the last cycle's tasks so the panel is not empty on open, then grown live. Capped to keep the DOM small.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import { CircleCheck, CircleX, Coins, GitMerge, Handshake, Hourglass, MessageSquare, Play, Radio, Rocket, Trophy, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Timeline, formatMoney, useBuilderView, type StatusTone, type TimelineEvent } from "@foundmill/dugout";
import { countOf, founderJargonHits, founderPhrase } from "@foundmill/shared";
import { useBusinessEvents, useGlossary, useWidgetQuery, type WidgetEvent } from "../data";
import { registerWidget, type WidgetProps } from "../registry";
import { WidgetFrame } from "../shared/frame";
import type { Page, TaskRow } from "../shared/types";

export const LiveFeedSettings = z.object({
  max: z.number().int().min(10).max(200).default(50),
  /** Hide fine-grained progress events. */
  quiet: z.boolean().default(true),
});
export type LiveFeedSettings = z.infer<typeof LiveFeedSettings>;

const QUIET_TYPES = new Set(["task.progressed", "bank.balance_updated"]);

interface Described {
  title: string;
  description?: string;
  icon: LucideIcon;
  tone: StatusTone;
  statusWord?: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}
/** An event's money carries its own currency (packages/events `Money`); an amount without one is not shown at all. */
function money(v: unknown): string | undefined {
  const m = v as { amountMinor?: number; currency?: string } | undefined;
  return m && typeof m.amountMinor === "number" && typeof m.currency === "string" ? formatMoney({ amountMinor: m.amountMinor, currency: m.currency }) : undefined;
}

/** Agent statuses as people read them (CLAUDE.md: an injured agent is "Down"); the enum keys never reach the screen. */
const HEALTH_WORD: Readonly<Record<string, string>> = { healthy: "Healthy", degraded: "Degraded", failing: "Failing", injured: "Down", paused: "Paused", idle: "Idle" };
/** A conversion by its kind: a signup is a signup, only a payment makes a customer. */
const CONVERSION_TITLE: Readonly<Record<string, string>> = { signup: "New signup", activation: "Activation reached", payment: "New paying customer" };
const APPROVAL_TITLE: Readonly<Record<string, string>> = { approved: "Approved", rejected: "Rejected", expired: "Approval expired", withdrawn: "Approval withdrawn" };
/** Every other event type in plain words; anything not listed reads "Business update", never its raw key. */
const EVENT_TITLE: Readonly<Record<string, string>> = {
  "holiday.started": "Vacation started",
  "holiday.ended": "Vacation ended",
  "mode.changed": "Business mode changed",
  "deploy.succeeded": "Deployed",
  "lead.created": "New lead",
  "campaign.launched": "Campaign launched",
  "channel.threshold_breached": "A channel went over its limit",
  "runway.threshold_crossed": "Cash running low",
  "bank.balance_updated": "Bank balance updated",
  "credential.expiring": "A connection needs renewing",
  "training.completed": "Training finished",
  "agent.promoted": "New agent version live",
  "filing.due": "Filing due",
  "contract.signed": "Contract signed",
  "connection.requested": "Connection request",
  "message.received": "New message",
  "negotiation.message": "New negotiation message",
  "decision.made": "Decision made",
  "idea.committed": "Business started",
  "spec.proposal_created": "Product spec change proposed",
  "spec.version_published": "Product spec published",
  "source.added": "Source added",
  "source.scored": "Source scored",
  "foundations.progressed": "Foundations updated",
  "conversation.message_posted": "New message",
};
const CYCLE_OUTCOME: Readonly<Record<string, string>> = { completed: "completed", time_box: "reached its time limit", waiting: "is waiting on you", stopped: "stopped", failed: "failed" };
const own = (map: Readonly<Record<string, string>>, key: string | undefined): string | undefined => (key !== undefined && Object.hasOwn(map, key) ? map[key] : undefined);

/** A round of work's outcome in the founder's words (Builder view off): "Round of work finished · 3 tasks done". */
const ROUND_OUTCOME: Readonly<Record<string, string>> = { completed: "Round of work finished", time_box: "Round of work reached its time limit", waiting: "Round of work is waiting on you", stopped: "Round of work stopped", failed: "Round of work did not finish" };

export interface DescribeOptions {
  /**
   * Builder view (docs/DESIGN.md): on reads the engine as before ("Cycle 3 started", "Merged PR #41"); off reads the
   * founder's words, with no cycle or PR number ("The team started a round of work", "Gone live: <title>"). Default on.
   */
  builder?: boolean;
}

/** Plain, specific words for each event (DESIGN §10); colour always comes with an icon and a word. */
export function describeEvent(e: WidgetEvent, opts: DescribeOptions = {}): Described {
  const p = e.payload;
  const builder = opts.builder ?? true;
  switch (e.type) {
    case "task.started":
      return { title: `Started: ${str(p.title) ?? "a task"}`, icon: Play, tone: "info", statusWord: "Started" };
    case "task.progressed": {
      const phase = str(p.phase)?.replace(/_/g, " ");
      return { title: `${phase ? phase.charAt(0).toUpperCase() + phase.slice(1) : "Working"}: ${Math.round(((p.progress as number) ?? 0) * 100)}%`, icon: Hourglass, tone: "neutral" };
    }
    case "task.completed": {
      // An agent's summary can carry the engine's numbers ("105 tests passed"): off, they read in the founder's words.
      const summary = str(p.summary);
      const description = summary && !builder && founderJargonHits(summary).length > 0 ? founderPhrase(summary) || undefined : summary;
      return { title: `Done: ${str(p.title) ?? "a task"}`, description, icon: CircleCheck, tone: p.outcome === "partial" ? "warn" : "good", statusWord: p.outcome === "partial" ? "Partial" : "Done" };
    }
    case "task.blocked":
      return { title: `Blocked: ${str(p.title) ?? "a task"}`, description: str(p.reason), icon: CircleX, tone: "bad", statusWord: "Blocked" };
    case "pr.merged":
      if (!builder) return { title: `Gone live: ${founderPhrase(str(p.title) ?? "") || "a change to the product"}`, icon: GitMerge, tone: "good", statusWord: "Live" };
      return { title: `Merged PR #${String(p.prNumber ?? "")}`.trim(), description: str(p.title), icon: GitMerge, tone: "good", statusWord: "Merged" };
    case "signup.created":
      return { title: "New signup", description: str(p.provider), icon: UserPlus, tone: "good" };
    case "activation.reached":
      return { title: "Activation reached", icon: Rocket, tone: "good" };
    case "payment.received":
      return { title: `Payment received${money(p.amount) ? ` · ${money(p.amount)}` : ""}`, description: str(p.productRef), icon: Coins, tone: "good", statusWord: p.firstPayment ? "First" : undefined };
    case "customer.converted": {
      const kind = str(p.kind);
      return { title: own(CONVERSION_TITLE, kind) ?? "Someone took the next step", description: money(p.amount), icon: kind === "payment" ? Trophy : kind === "signup" ? UserPlus : Rocket, tone: "good", statusWord: kind === "payment" ? "Win" : undefined };
    }
    case "lead.replied":
      return { title: "A lead replied", description: str(p.sentiment), icon: MessageSquare, tone: p.sentiment === "negative" ? "warn" : "info" };
    case "approval.requested":
      return { title: `Approval needed: ${str(p.title) ?? str(p.tool) ?? "an action"}`, icon: Handshake, tone: "warn", statusWord: "Ask" };
    case "approval.resolved": {
      const outcome = str(p.outcome);
      return { title: own(APPROVAL_TITLE, outcome) ?? "Approval resolved", description: str(p.note), icon: Handshake, tone: outcome === "rejected" ? "bad" : outcome === "approved" ? "good" : "neutral", statusWord: outcome === "approved" || outcome === "rejected" ? own(APPROVAL_TITLE, outcome) : undefined };
    }
    case "agent.health_changed": {
      const to = str(p.to);
      const word = own(HEALTH_WORD, to);
      return {
        title: !word ? "Agent status changed" : to === "healthy" ? "Agent healthy again" : `Agent ${word.toLowerCase()}`,
        description: str(p.reason),
        icon: to === "healthy" ? CircleCheck : CircleX,
        tone: to === "healthy" ? "good" : to === "failing" || to === "injured" ? "bad" : "warn",
        statusWord: word,
      };
    }
    case "cycle.started":
      if (!builder) return { title: "The team started a round of work", icon: Play, tone: "info" };
      return { title: `Cycle ${String(p.cycleNumber ?? "")} started`.replace("  ", " "), icon: Play, tone: "info" };
    case "cycle.completed":
      if (!builder) return { title: `${own(ROUND_OUTCOME, str(p.outcome)) ?? ROUND_OUTCOME.completed} · ${countOf(typeof p.tasksCompleted === "number" ? p.tasksCompleted : 0, "task")} done`, icon: CircleCheck, tone: p.outcome === "failed" ? "bad" : p.outcome === "completed" ? "good" : "neutral" };
      return { title: `Cycle ${String(p.cycleNumber ?? "")} ${own(CYCLE_OUTCOME, str(p.outcome)) ?? "completed"}`.replace("  ", " "), description: `${countOf(typeof p.tasksCompleted === "number" ? p.tasksCompleted : 0, "task")} done`, icon: CircleCheck, tone: p.outcome === "failed" ? "bad" : p.outcome === "completed" ? "good" : "neutral" };
    case "inbox.item_created":
      // A reader walled from Finance or the CRM gets the note without its subject (apps/stream walls).
      return { title: str(p.subject) ?? "New inbox note", icon: MessageSquare, tone: p.blocksContinue ? "bad" : "neutral", statusWord: p.blocksContinue ? "Needs you" : undefined };
    case "inbox.item_updated":
      // Ids only (no subject), so a member walled from the item learns nothing beyond the change itself.
      return p.change === "plan_confirmed" ? { title: "Plan confirmed", icon: CircleCheck, tone: "good", statusWord: "Confirmed" } : { title: "Inbox note archived", icon: MessageSquare, tone: "neutral" };
    case "membership.changed":
      return { title: p.change === "added" ? "Staff member added" : p.change === "removed" ? "Staff member removed" : "Staff access changed", icon: Users, tone: "neutral" };
    default:
      return { title: own(EVENT_TITLE, e.type) ?? "Business update", icon: Radio, tone: "neutral" };
  }
}

export function toTimelineEvent(e: WidgetEvent, fallbackAt: string, opts: DescribeOptions = {}): TimelineEvent {
  const d = describeEvent(e, opts);
  return { id: e.id ?? `${e.type}:${e.occurredAt ?? fallbackAt}:${Math.random().toString(36).slice(2, 8)}`, at: e.occurredAt ?? fallbackAt, title: d.title, description: d.description, icon: d.icon, tone: d.tone, statusWord: d.statusWord };
}

/** Seed rows from recent tasks so the feed has history before the first live frame. */
export function seedFromTasks(tasks: readonly TaskRow[], opts: DescribeOptions = {}): TimelineEvent[] {
  // Builder view off names each task by its founder title (0070) when it has one.
  const founder = opts.builder === false;
  return tasks
    .filter((t) => t.startedAt || t.endedAt)
    .map((t) => {
      const done = t.status === "done";
      const failed = t.status === "failed" || t.status === "stopped";
      return {
        id: `task:${t.id}:${t.status}`,
        at: (done || failed ? t.endedAt : t.startedAt) ?? t.updatedAt ?? new Date().toISOString(),
        title: `${done ? "Done" : failed ? "Failed" : "Started"}: ${(founder && t.founderTitle) || t.title}`,
        icon: done ? CircleCheck : failed ? CircleX : Play,
        tone: done ? ("good" as const) : failed ? ("bad" as const) : ("info" as const),
        statusWord: done ? "Done" : failed ? "Failed" : "Started",
      };
    });
}

function LiveFeedWidget({ settings }: WidgetProps<LiveFeedSettings>) {
  const tasks = useWidgetQuery<Page<TaskRow>>("dev.tasks.list", { limit: 20 });
  // The raw events are kept and described at render, so turning Builder view on or off rewords the feed in place.
  const [received, setReceived] = useState<{ event: WidgetEvent; id: string; at: string }[]>([]);
  useBusinessEvents((e) => {
    if (settings.quiet && QUIET_TYPES.has(e.type)) return;
    const at = new Date().toISOString();
    setReceived((prev) => [{ event: e, at, id: e.id ?? `${e.type}:${e.occurredAt ?? at}:${Math.random().toString(36).slice(2, 8)}` }, ...prev].slice(0, settings.max));
  });
  const builder = useBuilderView();
  const live = useMemo(() => received.map((r) => ({ ...toTimelineEvent(r.event, r.at, { builder }), id: r.id })), [received, builder]);
  const g = useGlossary();
  const events = useMemo(() => {
    const seen = new Set(live.map((e) => e.id));
    // Lines in the business's words ("Customer won" → "Client won").
    return [...live, ...seedFromTasks(tasks.data?.items ?? [], { builder }).filter((e) => !seen.has(e.id))].slice(0, settings.max).map((e) => (typeof e.title === "string" ? { ...e, title: g(e.title) } : e));
  }, [live, tasks.data, settings.max, g, builder]);
  return (
    <WidgetFrame
      title="Live feed"
      help={builder ? "Everything that happens in the business, newest first. A cycle is one round of work that ends with notes in your Inbox; the business mode is how much the team may do on its own." : "Everything that happens in the business, newest first. The team works in rounds that end with notes in your Inbox; the business mode is how much the team may do on its own."}
      data-widget="live_feed"
      queries={[tasks]}
      empty={tasks.data && events.length === 0 ? { icon: Radio, text: builder ? "Events appear here the moment agents start working. Press Continue to begin a cycle." : "Events appear here the moment agents start working. Press Continue to start a round of work." } : null}
      footer={<span>{live.length > 0 ? `${live.length} live` : "Waiting for live events"}</span>}
    >
      <Timeline events={events} order="desc" emptyText="Nothing yet." />
    </WidgetFrame>
  );
}

export const liveFeedWidget = registerWidget<LiveFeedSettings>({
  key: "live_feed",
  title: "Live feed",
  description: "Everything that happens in the business, as it happens.",
  icon: "radio",
  surfaces: ["home", "department"],
  // A feed: the body scrolls; this shows about eight events.
  defaultSize: { w: 4, h: 14, minW: 3, minH: 8 },
  settingsSchema: LiveFeedSettings,
  defaultSettings: LiveFeedSettings.parse({}),
  Component: LiveFeedWidget,
});
