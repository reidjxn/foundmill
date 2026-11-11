/**
 * The push notifier (docs/mobile/BACKEND_CHANGES.md §4): told every event the outbox relay publishes (services/relay.ts
 * `onPublished`), it decides which founders' phones hear about it and asks the gateway to send.
 *
 * For an event of a kind the app knows (`decide.ts`): the business's members (never the example's visitors), each of
 * whom must (1) have a registered phone, (2) have the kind switched on in their preferences, and (3) be able to read the
 * section the event belongs to; what they read follows their walls (no amounts without Finance, no customer names
 * without the CRM) and their "Hide amounts on the lock screen" switch; agents are named the way they chose. Readers who
 * would read the same words share one send. Nothing is read from the database before the cheap checks pass (the event
 * type, then members with phones), so a business with no phones costs one query per candidate event and no gateway call.
 *
 * Delivery is at least once from the relay, so events are de-duplicated by id in memory; one `push.sent` event per
 * source event (idempotency key `push:<eventId>`) is the audit of what reached a phone. A gateway or provider failure is
 * logged and dropped: a notification is a courtesy, never a step the business waits on.
 */
import { MAX_SUBSCRIPTIONS_PER_SEND, PUSH_BODY_MAX, PUSH_TITLE_MAX } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import type { PlatformEvent } from "@foundmill/events";
import { hasSectionAccess, type AgentIdentity } from "@foundmill/shared";
import type { ApiDeps } from "../../context";
import { writeEventRow } from "../events";
import type { GatewayPushResult } from "../gateway";
import { isPushEventType, pushPlanFor, type PushFacts, type PushPlan, type PushView } from "./decide";

/** OneSignal's ceiling per request. */
const MAX_PER_SEND = MAX_SUBSCRIPTIONS_PER_SEND;
/** The provider's ceilings; longer texts are cut with an ellipsis. */
const BODY_MAX = PUSH_BODY_MAX;
const TITLE_MAX = PUSH_TITLE_MAX;
/** Event ids remembered against a re-delivery. */
const REMEMBERED_EVENTS = 5_000;

export type PushOutcome =
  | { status: "sent"; kind: string; recipients: number; devices: number; sends: number }
  | { status: "skipped"; reason: "duplicate" | "not_a_push_event" | "nothing_to_say" | "no_members" | "no_devices" | "no_recipients" | "stopped" }
  | { status: "failed"; kind: string; reason: string };

export interface PushNotifier {
  /** The relay's hook: queues the events and returns at once. */
  onPublished(events: readonly PlatformEvent[]): void;
  /** One event, end to end (tests and the queue). */
  handle(event: PlatformEvent): Promise<PushOutcome>;
  /** Stop taking events and wait for the one in flight. */
  stop(): Promise<void>;
}

export type PushNotifierDeps = Pick<ApiDeps, "db" | "gateway" | "log">;

const cut = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);

export function createPushNotifier(deps: PushNotifierDeps, options: { now?: () => Date } = {}): PushNotifier {
  const now = options.now ?? (() => new Date());
  const seen = new Set<string>();
  let queue: PlatformEvent[] = [];
  let draining: Promise<void> | null = null;
  let stopped = false;

  const remember = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > REMEMBERED_EVENTS) {
      const oldest = seen.values().next().value;
      if (oldest) seen.delete(oldest);
    }
    return true;
  };

  /** The facts the words need, read once per event. Anything missing reads as absent, never as an error. */
  const factsFor = async (event: PlatformEvent): Promise<PushFacts> => {
    const facts: PushFacts = { now: now() };
    const b = event.businessId;
    const agent = async (agentId: string | null | undefined): Promise<AgentIdentity | null> => {
      if (!agentId) return null;
      const a = await repos.agents.get(deps.db, b, agentId).catch(() => null);
      return a ? { name: a.name, role: a.role, personaKey: a.personaKey, agentType: a.agentType, layer: a.layer } : null;
    };
    switch (event.type) {
      case "inbox.item_created":
        facts.agent = await agent(event.payload.fromAgentId);
        break;
      case "agent.health_changed":
        facts.agent = await agent(event.payload.agentId);
        break;
      case "customer.converted":
        facts.customerName = (await repos.entities.get(deps.db, b, event.payload.entityId).catch(() => null))?.displayName ?? null;
        break;
      case "goal.achieved":
        facts.goalSentence = (await repos.goals.get(deps.db, b, event.payload.goalId).catch(() => null))?.sentence ?? null;
        break;
      case "cycle.run_ended":
        facts.openNotes = (await repos.inbox.countByTab(deps.db, b).catch(() => null))?.all ?? null;
        break;
      default:
        break;
    }
    return facts;
  };

  /** One event, end to end; the queue's batch in flight finishes even after `stop()` (nothing half-sent is left behind). */
  const process = async (event: PlatformEvent): Promise<PushOutcome> => {
    if (!isPushEventType(event.type)) return { status: "skipped", reason: "not_a_push_event" };
    if (!remember(event.id)) return { status: "skipped", reason: "duplicate" };
    const businessId = event.businessId;
    const members = await repos.memberships.list(deps.db, businessId);
    if (members.length === 0) return { status: "skipped", reason: "no_members" };
    const devicesByUser = await repos.devices.forUsers(deps.db, members.map((m) => m.userId));
    if (devicesByUser.size === 0) return { status: "skipped", reason: "no_devices" };
    const plan: PushPlan | null = pushPlanFor(event, await factsFor(event));
    if (!plan) return { status: "skipped", reason: "nothing_to_say" };

    // Readers who would read the same words share one send.
    const groups = new Map<string, { title: string; body: string; tokens: string[]; people: number }>();
    for (const m of members) {
      const devices = devicesByUser.get(m.userId);
      if (!devices?.length) continue;
      if (!hasSectionAccess(m, plan.section, "read")) continue;
      const prefs = await repos.preferences.get(deps.db, m.userId);
      if (!prefs.notifications[plan.kind]) continue;
      const view: PushView = { amounts: hasSectionAccess(m, "finance", "read") && !prefs.hideAmountsOnLockScreen, names: hasSectionAccess(m, "crm", "read"), anthropomorphic: prefs.anthropomorphicAgents, agentStyle: prefs.agentStyle };
      const text = plan.text(view);
      const title = cut(text.title, TITLE_MAX);
      const body = cut(text.body, BODY_MAX);
      const key = `${title}\n${body}`;
      const group = groups.get(key) ?? { title, body, tokens: [], people: 0 };
      group.tokens.push(...devices.map((d) => d.token));
      group.people += 1;
      groups.set(key, group);
    }
    if (groups.size === 0) return { status: "skipped", reason: "no_recipients" };

    const results: GatewayPushResult[] = [];
    let recipients = 0;
    let devices = 0;
    try {
      for (const group of groups.values()) {
        for (let i = 0; i < group.tokens.length; i += MAX_PER_SEND) {
          const subscriptionIds = group.tokens.slice(i, i + MAX_PER_SEND);
          results.push(await deps.gateway.sendPush({ businessId, kind: plan.kind, subscriptionIds, title: group.title, body: group.body, data: plan.data, collapseKey: plan.collapseKey }));
          devices += subscriptionIds.length;
        }
        recipients += group.people;
      }
    } catch (err) {
      deps.log.warn({ businessId, eventId: event.id, type: event.type, kind: plan.kind, err: (err as Error).message }, "push not sent");
      return { status: "failed", kind: plan.kind, reason: (err as Error).message };
    }
    const mode = results[0]?.mode ?? "mock";
    await writeEventRow(
      deps.db,
      {
        businessId,
        type: "push.sent",
        actor: { kind: "system", id: "push-notifier" },
        payload: { kind: plan.kind, sourceEventId: event.id, sourceEventType: event.type, recipients, devices, provider: "onesignal", mode, providerMessageIds: results.map((r) => r.id).filter((id) => id.length > 0).slice(0, 50) },
      },
      `push:${event.id}`,
    ).catch((err: unknown) => deps.log.warn({ businessId, eventId: event.id, err: (err as Error).message }, "push.sent event not written"));
    deps.log.info({ businessId, eventId: event.id, type: event.type, kind: plan.kind, recipients, devices, sends: results.length, mode }, "push sent");
    return { status: "sent", kind: plan.kind, recipients, devices, sends: results.length };
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      const batch = queue;
      queue = [];
      for (const event of batch) {
        try {
          await process(event);
        } catch (err) {
          deps.log.warn({ eventId: event.id, type: event.type, err: (err as Error).message }, "push notifier failed on an event");
        }
      }
    }
  };

  return {
    onPublished(events) {
      if (stopped) return;
      for (const e of events) if (isPushEventType(e.type)) queue.push(e);
      if (queue.length === 0 || draining) return;
      draining = drain().finally(() => {
        draining = null;
      });
    },
    handle: (event) => (stopped ? Promise.resolve({ status: "skipped", reason: "stopped" } as const) : process(event)),
    async stop() {
      stopped = true;
      queue = [];
      await draining;
    },
  };
}
