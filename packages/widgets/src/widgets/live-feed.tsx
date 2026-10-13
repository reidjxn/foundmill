"use client";
/**
 * Live feed widget (BUILD §11.2): platform events as they arrive on `ev:<businessId>`, newest first. Seeded from
 * the last cycle's tasks so the panel is not empty on open, then grown live. Capped to keep the DOM small.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import { CircleCheck, CircleX, Coins, GitMerge, Handshake, Hourglass, MessageSquare, Play, Radio, Rocket, Trophy, UserPlus, Users, type LucideIcon } from "lucide-react";
import { Timeline, formatMoney, type StatusTone, type TimelineEvent } from "@foundmill/dugout";
import { useBusinessEvents, useWidgetQuery, type WidgetEvent } from "../data";
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

/** Plain, specific words for each event (DESIGN §10); colour always comes with an icon and a word. */
export function describeEvent(e: WidgetEvent): Described {
  const p = e.payload;
  switch (e.type) {
    case "task.started":
      return { title: `Started: ${str(p.title) ?? "a task"}`, icon: Play, tone: "info", statusWord: "Started" };
    case "task.progressed":
      return { title: `${str(p.phase) ?? "Working"}: ${Math.round(((p.progress as number) ?? 0) * 100)}%`, icon: Hourglass, tone: "neutral" };
    case "task.completed":
      return { title: `Done: ${str(p.title) ?? "a task"}`, description: str(p.summary), icon: CircleCheck, tone: p.outcome === "partial" ? "warn" : "good", statusWord: p.outcome === "partial" ? "Partial" : "Done" };
    case "task.blocked":
      return { title: `Blocked: ${str(p.title) ?? "a task"}`, description: str(p.reason), icon: CircleX, tone: "bad", statusWord: "Blocked" };
    case "pr.merged":
      return { title: `Merged PR #${String(p.prNumber ?? "")}`.trim(), description: str(p.title), icon: GitMerge, tone: "good", statusWord: "Merged" };
    case "signup.created":
      return { title: "New signup", description: str(p.provider), icon: UserPlus, tone: "good" };
    case "activation.reached":
      return { title: "Activation reached", icon: Rocket, tone: "good" };
    case "payment.received":
      return { title: `Payment received${money(p.amount) ? ` · ${money(p.amount)}` : ""}`, description: str(p.productRef), icon: Coins, tone: "good", statusWord: p.firstPayment ? "First" : undefined };
    case "customer.converted":
      return { title: `Customer won (${str(p.kind) ?? "win"})`, description: money(p.amount), icon: Trophy, tone: "good", statusWord: "Won" };
    case "lead.replied":
      return { title: "A lead replied", description: str(p.sentiment), icon: MessageSquare, tone: p.sentiment === "negative" ? "warn" : "info" };
    case "approval.requested":
      return { title: `Approval needed: ${str(p.title) ?? str(p.tool) ?? "an action"}`, icon: Handshake, tone: "warn", statusWord: "Ask" };
    case "approval.resolved":
      return { title: `Approval ${str(p.outcome) ?? "resolved"}`, icon: Handshake, tone: p.outcome === "rejected" ? "bad" : "good" };
    case "agent.health_changed":
      return { title: `Agent now ${str(p.to) ?? "changed"}`, description: str(p.reason), icon: p.to === "healthy" ? CircleCheck : CircleX, tone: p.to === "healthy" ? "good" : p.to === "failing" || p.to === "injured" ? "bad" : "warn", statusWord: str(p.to) };
    case "cycle.started":
      return { title: `Cycle ${String(p.cycleNumber ?? "")} started`.replace("  ", " "), icon: Play, tone: "info" };
    case "cycle.completed":
      return { title: `Cycle ${String(p.cycleNumber ?? "")} ${str(p.outcome) ?? "completed"}`.replace("  ", " "), description: `${String(p.tasksCompleted ?? 0)} tasks done`, icon: CircleCheck, tone: "good" };
    case "inbox.item_created":
      // A reader walled from Finance or the CRM gets the note without its subject (apps/stream walls).
      return { title: str(p.subject) ?? "New inbox note", icon: MessageSquare, tone: p.blocksContinue ? "bad" : "neutral", statusWord: p.blocksContinue ? "Respond" : undefined };
    case "inbox.item_updated":
      // Ids only (no subject), so a member walled from the item learns nothing beyond the change itself.
      return p.change === "plan_confirmed" ? { title: "Plan confirmed", icon: CircleCheck, tone: "good", statusWord: "Confirmed" } : { title: "Inbox note archived", icon: MessageSquare, tone: "neutral" };
    case "membership.changed":
      return { title: p.change === "added" ? "Staff member added" : p.change === "removed" ? "Staff member removed" : "Staff access changed", icon: Users, tone: "neutral" };
    default:
      return { title: e.type.replace(/[._]/g, " "), icon: Radio, tone: "neutral" };
  }
}

export function toTimelineEvent(e: WidgetEvent, fallbackAt: string): TimelineEvent {
  const d = describeEvent(e);
  return { id: e.id ?? `${e.type}:${e.occurredAt ?? fallbackAt}:${Math.random().toString(36).slice(2, 8)}`, at: e.occurredAt ?? fallbackAt, title: d.title, description: d.description, icon: d.icon, tone: d.tone, statusWord: d.statusWord };
}

/** Seed rows from recent tasks so the feed has history before the first live frame. */
export function seedFromTasks(tasks: readonly TaskRow[]): TimelineEvent[] {
  return tasks
    .filter((t) => t.startedAt || t.endedAt)
    .map((t) => {
      const done = t.status === "done";
      const failed = t.status === "failed" || t.status === "stopped";
      return {
        id: `task:${t.id}:${t.status}`,
        at: (done || failed ? t.endedAt : t.startedAt) ?? t.updatedAt ?? new Date().toISOString(),
        title: `${done ? "Done" : failed ? "Failed" : "Started"}: ${t.title}`,
        icon: done ? CircleCheck : failed ? CircleX : Play,
        tone: done ? ("good" as const) : failed ? ("bad" as const) : ("info" as const),
        statusWord: done ? "Done" : failed ? "Failed" : "Started",
      };
    });
}

function LiveFeedWidget({ settings }: WidgetProps<LiveFeedSettings>) {
  const tasks = useWidgetQuery<Page<TaskRow>>("dev.tasks.list", { limit: 20 });
  const [live, setLive] = useState<TimelineEvent[]>([]);
  useBusinessEvents((e) => {
    if (settings.quiet && QUIET_TYPES.has(e.type)) return;
    setLive((prev) => [toTimelineEvent(e, new Date().toISOString()), ...prev].slice(0, settings.max));
  });
  const events = useMemo(() => {
    const seen = new Set(live.map((e) => e.id));
    return [...live, ...seedFromTasks(tasks.data?.items ?? []).filter((e) => !seen.has(e.id))].slice(0, settings.max);
  }, [live, tasks.data, settings.max]);
  return (
    <WidgetFrame
      title="Live feed"
      data-widget="live_feed"
      queries={[tasks]}
      empty={tasks.data && events.length === 0 ? { icon: Radio, text: "Events appear here the moment agents start working. Press Continue to begin a cycle." } : null}
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
  defaultSize: { w: 4, h: 12, minW: 3, minH: 8 },
  settingsSchema: LiveFeedSettings,
  defaultSettings: LiveFeedSettings.parse({}),
  Component: LiveFeedWidget,
});
