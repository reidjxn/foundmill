/**
 * What a business event means for a founder's phone (docs/mobile/BACKEND_CHANGES.md §4; the words are the mobile voice
 * skill's §7). Pure: given the event and the few facts the notifier read for it (an agent's identity, a customer's name,
 * the goal's sentence, how many notes are open), says which kind of notification it is, which section a person must be
 * able to read to get it, how the app routes a tap, and the title and body for one reader's view (whether they may see
 * amounts and customer names, and how they name agents).
 */
import type { PlatformEvent } from "@foundmill/events";
import { agentLabel, formatMoney, type AgentIdentity, type AgentStyle, type Money, type NotificationKind, type Section } from "@foundmill/shared";

/** The event types the notifier looks at; everything else is dropped before any database read. */
export const PUSH_EVENT_TYPES = ["inbox.item_created", "approval.requested", "customer.converted", "agent.health_changed", "runway.threshold_crossed", "cycle.run_ended", "goal.achieved"] as const satisfies readonly PlatformEvent["type"][];
export type PushEventType = (typeof PUSH_EVENT_TYPES)[number];
export const isPushEventType = (type: string): type is PushEventType => (PUSH_EVENT_TYPES as readonly string[]).includes(type);

/** What the notifier read for one event, when the words need it. */
export interface PushFacts {
  agent?: AgentIdentity | null;
  customerName?: string | null;
  goalSentence?: string | null;
  /** Notes open in the Inbox after a run of cycles. */
  openNotes?: number | null;
  now?: Date;
}

/** One reader's view: what they may see and how they name agents (Settings › Preferences). */
export interface PushView {
  amounts: boolean;
  names: boolean;
  anthropomorphic: boolean;
  agentStyle: AgentStyle;
}

export interface PushText {
  title: string;
  body: string;
}

export interface PushPlan {
  kind: NotificationKind;
  /** The section a person must be able to read to be told at all. */
  section: Section;
  /** What the app routes on when the notification is tapped. */
  data: Record<string, string>;
  /** Later notifications with the same key replace earlier ones on the phone. */
  collapseKey: string;
  text(view: PushView): PushText;
}

/** "in 5 min", "in 2 hr", "on Oct 21"; "any minute now" for a time already passed. */
export function expectedBackWords(at: Date, now: Date): string {
  const minutes = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (minutes < 1) return "any minute now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hr`;
  return `on ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at)}`;
}

const amountSuffix = (amount: Money | null | undefined, view: PushView): string => (view.amounts && amount ? ` · ${formatMoney(amount)}` : "");
const who = (agent: AgentIdentity | null | undefined, view: PushView): string | null => (agent ? agentLabel(agent, view.anthropomorphic, view.agentStyle) : null);

/** The plan for one event, or null when nothing should reach a phone. */
export function pushPlanFor(event: PlatformEvent, facts: PushFacts = {}): PushPlan | null {
  const businessId = event.businessId;
  switch (event.type) {
    case "inbox.item_created": {
      const p = event.payload;
      const data = { businessId, kind: "inbox", itemId: p.inboxItemId };
      const collapseKey = `inbox:${p.inboxItemId}`;
      if (p.type === "decision") {
        return {
          kind: "decision",
          section: "inbox",
          data,
          collapseKey,
          text: (view) => {
            const name = who(facts.agent, view);
            return { title: "Needs your answer", body: name ? `${name}: ${p.subject}` : p.subject };
          },
        };
      }
      // A hard stop (credits used up, a revoked key) is the one warning that holds Continue; it is told as a decision.
      if (p.type === "warning" && p.blocksContinue) {
        return { kind: "decision", section: "inbox", data, collapseKey, text: () => ({ title: "The team has stopped", body: p.subject }) };
      }
      return null;
    }
    case "approval.requested": {
      const p = event.payload;
      return {
        kind: "approval",
        section: "inbox",
        data: { businessId, kind: "inbox", approvalId: p.approvalId },
        collapseKey: `approval:${p.approvalId}`,
        text: (view) => ({ title: "Needs your go-ahead", body: `${p.summary}${amountSuffix(p.amount, view)}` }),
      };
    }
    case "customer.converted": {
      const p = event.payload;
      // Past the 100th win of a kind only the big ones get their own update; the rest are in the daily round-up.
      if (!p.fullMatchDay) return null;
      return {
        kind: "customer",
        section: "inbox",
        data: { businessId, kind: "journey", journeyId: p.journeyId, entityId: p.entityId },
        collapseKey: `journey:${p.journeyId}`,
        text: (view) => {
          const name = view.names && facts.customerName ? facts.customerName : "A customer";
          const body = p.kind === "payment" ? `${name} just became a paying customer${amountSuffix(p.amount, view)}` : p.kind === "activation" ? `${name} is now active` : `${name} just signed up`;
          return { title: "New customer", body };
        },
      };
    }
    case "agent.health_changed": {
      const p = event.payload;
      if (p.to !== "injured") return null;
      return {
        kind: "agent_down",
        section: "team",
        data: { businessId, kind: "team", agentId: p.agentId },
        collapseKey: `agent:${p.agentId}`,
        text: (view) => ({
          title: `${who(facts.agent, view) ?? "An agent"} is down`,
          body: p.expectedReturnAt ? `Expected back ${expectedBackWords(new Date(p.expectedReturnAt), facts.now ?? new Date())}` : "Reconnect the integration to see an expected return",
        }),
      };
    }
    case "runway.threshold_crossed": {
      const p = event.payload;
      if (p.direction !== "below") return null;
      const months = Math.max(0, Math.round(p.runwayMonths));
      return {
        kind: "runway",
        section: "finance",
        data: { businessId, kind: "today" },
        collapseKey: "runway",
        text: () => ({ title: "Runway", body: months < 1 ? "Cash lasts less than a month at today's spending (Estimate)." : `Cash lasts about ${months} month${months === 1 ? "" : "s"} at today's spending (Estimate).` }),
      };
    }
    case "cycle.run_ended": {
      const open = facts.openNotes ?? 0;
      return {
        kind: "run_finished",
        section: "inbox",
        data: { businessId, kind: "inbox" },
        collapseKey: "run",
        text: () => ({ title: "The team finished a round", body: open === 0 ? "Nothing new needs you" : open === 1 ? "1 note in your Inbox" : `${open} notes in your Inbox` }),
      };
    }
    case "goal.achieved": {
      const p = event.payload;
      return {
        kind: "goal",
        section: "inbox",
        data: { businessId, kind: "today", goalId: p.goalId },
        collapseKey: `goal:${p.goalId}`,
        text: () => ({ title: "Goal reached", body: facts.goalSentence ?? "Your goal was reached" }),
      };
    }
    default:
      return null;
  }
}
