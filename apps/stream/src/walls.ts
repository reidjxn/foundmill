/**
 * Section walls on `ev:<businessId>` (BUILD §11.9; security review S1). The api walls staff off sections with
 * `sectionRead(...)` and the Inbox redaction; the business stream carries the same facts as raw platform events, so
 * every event type is filed here under the sections it belongs to, the same walls the procedures that serve it apply:
 *
 *   sections  a reader without read access to any of them never receives the event (a member walled from Finance
 *             gets no `payment.received`, `bank.balance_updated` or `runway.threshold_crossed`);
 *   hide      payload fields taken out for a reader walled from that section, who still receives the event (a
 *             finance-walled member learns that a cycle ended, not what it cost; a CRM-walled one that someone signed
 *             up, not their email). A changed event carries `redacted: [...]` on its envelope, like an Inbox note.
 *
 * Free text that can quote other sections (note subjects, task summaries, decision text) is hidden behind both the
 * Finance and the CRM wall: the stream cannot mask it the way the Inbox does, and tabs refetch the walled procedures
 * on these events anyway. The table is checked against EVENT_TYPES at compile time: a new event type needs a line
 * here. An event of a type the table does not know (a newer writer during a deploy) reaches only readers without walls.
 *
 * One kind of event is walled from everyone: a person-addressed one (`PERSON_ADDRESSED_EVENT_TYPES`: a connection request
 * or a message from another founder). It is about its recipient, not the business, so it is never delivered on a business
 * stream, not even to the owner or to a reader without walls; the api no longer writes them to a business at all (FU-S-2)
 * and this keeps one that still arrives (an older api during a deploy, a stray writer) from reaching the staff.
 *
 * An account-scoped event (`ACCOUNT_EVENT_TYPES`: a fact about one person, such as their profile going public, or a
 * sign-up that a public page brought: `signup.attributed` for the new person, `referral.arrived` for the person
 * credited) is walled from every reader of a business stream in the same way, and has no line in the table: it is
 * never written to a business and never relayed to `ev:`. It travels on the person's own `ae:<userId>`, where
 * `viewAccountEvent` lets through only that person's own account events, cut to the fields a person may read of them.
 */
import type { StreamEntry } from "@foundmill/events";
import { ACCOUNT_EVENT_TYPES, isAccountEventType, isPersonAddressedEvent, PERSON_ADDRESSED_EVENT_TYPES, SECTIONS, walledSections, type BusinessEventType, type Section, type SectionMembership } from "@foundmill/shared";

export interface EventWall {
  /** Sections the reader must be able to read to receive the event at all; empty for every member. */
  sections: readonly Section[] | ((payload: Record<string, unknown>) => readonly Section[]);
  /** Payload fields (dotted paths) hidden from a reader walled from that section. */
  hide?: Partial<Record<Section, readonly string[]>>;
}

/** Same rule as apps/api `sectionForSubject`: a desk conversation about an Inbox note is the Inbox's, any other the Team's. */
const conversationSections = (payload: Record<string, unknown>): readonly Section[] => [payload.subjectKind === "inbox_item" ? "inbox" : "team"];

/** Free text written by agents or people about the business: it may quote amounts and customers. */
const freeText = (...fields: string[]): Partial<Record<Section, readonly string[]>> => ({ finance: fields, crm: fields });

export const EVENT_WALLS = {
  "idea.committed": { sections: [] },
  "spec.proposal_created": { sections: ["product"] },
  "spec.version_published": { sections: ["product"] },
  "source.added": { sections: ["product"] },
  "source.scored": { sections: ["product"] },
  "task.started": { sections: ["development"] },
  "task.progressed": { sections: ["development"] },
  "task.completed": { sections: ["development"], hide: { finance: ["cost", "summary"], crm: ["summary"] } },
  "task.blocked": { sections: ["development"], hide: freeText("detail") },
  "pr.merged": { sections: ["development"] },
  "deploy.succeeded": { sections: ["development"] },
  "lead.created": { sections: ["distribution"], hide: { crm: ["source", "country", "lawfulBasis"] } },
  "lead.replied": { sections: ["distribution"], hide: { crm: ["summary"] } },
  "campaign.launched": { sections: ["distribution"], hide: { finance: ["budget"] } },
  "channel.threshold_breached": { sections: ["distribution"], hide: { finance: ["value", "threshold"] } },
  "signup.created": { sections: [], hide: { crm: ["customer"] } },
  "activation.reached": { sections: [] },
  "payment.received": { sections: ["finance"], hide: { crm: ["customer"] } },
  "customer.converted": { sections: [], hide: { finance: ["amount", "acquisitionCost"] } },
  "bank.balance_updated": { sections: ["finance"] },
  "runway.threshold_crossed": { sections: ["finance"] },
  "agent.health_changed": { sections: [], hide: { finance: ["signals.budgetRemaining"] } },
  "credential.expiring": { sections: ["settings"] },
  "training.completed": { sections: ["team"], hide: { finance: ["cost"] } },
  "agent.promoted": { sections: ["team"] },
  "approval.requested": { sections: ["inbox"], hide: { finance: ["amount", "summary"], crm: ["summary"] } },
  "approval.resolved": { sections: ["inbox"], hide: freeText("note") },
  "mode.changed": { sections: [] },
  "holiday.started": { sections: [], hide: { finance: ["budgetCeiling", "untilCondition"] } },
  "holiday.ended": { sections: [], hide: { finance: ["spent"] } },
  "filing.due": { sections: ["legal"], hide: { finance: ["estimatedFee"] } },
  "contract.signed": { sections: ["legal"], hide: { finance: ["value"] } },
  "connection.requested": { sections: ["live"] },
  "message.received": { sections: ["live"] },
  // The terms are free text written by either side's agent ("£49 a seat for 12 months"): they go with the price.
  "negotiation.message": { sections: ["live"], hide: { finance: ["proposal.price", "proposal.terms"] } },
  "cycle.started": { sections: [], hide: { finance: ["budget"] } },
  "cycle.completed": { sections: [], hide: { finance: ["cost"] } },
  // Continue's run (Nov 7, 2026): ids, a count and a reason; the cost goes with the money.
  "cycle.run_started": { sections: [] },
  "cycle.run_ended": { sections: [], hide: { finance: ["cost"] } },
  // Autopilot (0055): the chip is Home's; the day's spend ceiling is a money figure, hidden from a reader walled off Finance.
  "autopilot.changed": { sections: [], hide: { finance: ["spendCeiling"] } },
  "autopilot.cycle_started": { sections: [] },
  "inbox.item_created": { sections: ["inbox"], hide: { finance: ["subject", "cost"], crm: ["subject"] } },
  // Ids and the kind of change only (no subject): a member allowed the Inbox learns nothing beyond the change itself.
  "inbox.item_updated": { sections: ["inbox"] },
  "decision.made": { sections: ["inbox"], hide: freeText("freeText") },
  "foundations.progressed": { sections: ["product"] },
  // The Product Researcher's plan is ready (ids only): the Research tab refetches `product.research.get`.
  "product.research_drafted": { sections: ["product"] },
  "conversation.message_posted": { sections: conversationSections, hide: freeText("preview") },
  "membership.changed": { sections: [] },
  // Which Settings fields a save changed (names only, never values): every member's open tab refetches the business.
  "business.updated": { sections: [] },
  // A typed message between two agents (the platform tools): the Team's, and its subject and body are agent-written free text.
  "agent.message_sent": { sections: ["team"], hide: freeText("subject", "body") },
  // The founder's sign-off of the specification or roadmap (their notes are their own free text about the product).
  "product.signoff_decided": { sections: ["product"], hide: freeText("notes") },
  // Distribution started: ids and a count only.
  "distribution.started": { sections: ["distribution"] },
  // The business's goal (0072): ids, its kind, target and date. A revenue goal's numbers are money, so a reader walled off
  // Finance gets the event without them; the founder's change words are their own free text.
  "goal.proposed": { sections: ["inbox"], hide: { finance: ["targetValue"] } },
  "goal.approved": { sections: ["inbox"], hide: { finance: ["targetValue", "startValue"] } },
  "goal.change_requested": { sections: ["inbox"], hide: freeText("words") },
  "goal.achieved": { sections: ["inbox"], hide: { finance: ["targetValue", "achievedValue"] } },
  // A project's public page went live or was taken down (0077): its id and address, which are public anyway.
  "page.published": { sections: ["product"] },
  "team_call.started": { sections: ["team"], hide: freeText("topic") },
  "team_call.ended": { sections: ["team"] },
  "page.unpublished": { sections: ["product"] },
  // Someone followed the page (0079): ids only; the follower's record is the CRM's to show.
  "page.followed": { sections: ["product"], hide: { crm: ["entityId", "consentId"] } },
  // The guided layer's product signals (one founder's own use of tours, explainers and definitions): metrics only, so
  // on the stream they reach no one but the readers of Settings.
  "guidance.tour_completed": { sections: ["settings"] },
  "guidance.tour_skipped": { sections: ["settings"] },
  "guidance.explainer_dismissed": { sections: ["settings"] },
  "guidance.term_opened": { sections: ["settings"] },
  "guidance.turned_off": { sections: ["settings"] },
  "push.sent": { sections: ["settings"] },
  // A message sent from the project's Foundmill address (0078): ids and a recipient hash, never the address or the body.
  "mail.sent": { sections: ["distribution"] },
  // Foundmill emailed one of the business's people about a waiting note: ids only, like push.sent.
  "notify.email_sent": { sections: ["settings"] },
  // The return loop: one founder's own sessions and the emails sent to them. Metrics only; Settings readers alone.
  "founder.session_started": { sections: ["settings"] },
  // A milestone shown on the project's page or taken off it (0089): its id, key and public addresses.
  "milestone.shown": { sections: ["product"] },
  "milestone.hidden": { sections: ["product"] },
  // A share control was pressed (tap-to-post): a product signal for metrics, never pushed for a screen. Filed with the
  // metrics-only events so a stray one reaches no one but Settings' readers.
  "share.opened": { sections: ["settings"] },
  // The team drafted a post for the founder to share by tap: ids and the trigger's kind, never the words. The Creative
  // tab and Today follow it.
  "post.drafted": { sections: ["distribution"] },
  // The page quiz approved, turned on or off (0101): ids and its shape, never the words. The Public page tab follows.
  "quiz.approved": { sections: ["product"] },
  "quiz.published": { sections: ["product"] },
  "quiz.unpublished": { sections: ["product"] },
} as const satisfies { readonly [K in BusinessEventType]: EventWall };

/** What one reader may see of business events: their walls (sections they may not read at all). */
export interface EventView {
  /** Stable key of the walls, for sharing one decision between readers with the same walls. */
  readonly key: string;
  readonly walled: ReadonlySet<Section>;
}

const OPEN_VIEW: EventView = { key: "", walled: new Set() };
const CLOSED_VIEW: EventView = { key: SECTIONS.join(","), walled: new Set(SECTIONS) };

/** The view of a membership. Without one (a decision that carried none) the reader is walled from everything. */
export function eventView(membership: SectionMembership | null | undefined): EventView {
  if (!membership) return CLOSED_VIEW;
  const walled = walledSections(membership);
  if (walled.length === 0) return OPEN_VIEW;
  return { key: walled.join(","), walled: new Set(walled) };
}

/** Decisions per stream entry and view key: one entry is filtered once for every reader with the same walls. */
const decided = new WeakMap<StreamEntry, Map<string, string | null>>();

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Removes a dotted path from a (copied) object; true when something was there. */
function removePath(target: Json, path: string): boolean {
  const [head, ...rest] = path.split(".");
  if (!head || !(head in target)) return false;
  if (rest.length === 0) {
    delete target[head];
    return true;
  }
  const child = target[head];
  if (!isObject(child)) return false;
  const copy = { ...child };
  const removed = removePath(copy, rest.join("."));
  if (removed) target[head] = copy;
  return removed;
}

function typeInJson(json: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(json);
    return isObject(parsed) && typeof parsed.type === "string" ? parsed.type : undefined;
  } catch {
    return undefined;
  }
}

/** A type that belongs to a person and never to a business's readers: person-addressed, or account-scoped. */
const belongsToAPerson = (type: string | null | undefined): boolean => isPersonAddressedEvent(type) || isAccountEventType(type);
const PERSONAL_TYPES: readonly string[] = [...PERSON_ADDRESSED_EVENT_TYPES, ...ACCOUNT_EVENT_TYPES];

/** The answer of `personAddressed` per stream entry: decided once, whatever the number of readers. */
const personal = new WeakMap<StreamEntry, boolean>();

/**
 * Whether the entry is a person's own event (person-addressed or account-scoped: never delivered on a business
 * stream). The relay always writes `type` beside the JSON; the JSON is parsed as well only when its text names one of
 * these types, so an entry whose `type` field and JSON disagree is still caught.
 */
function personAddressed(entry: StreamEntry, json: string): boolean {
  const known = personal.get(entry);
  if (known !== undefined) return known;
  const answer = belongsToAPerson(entry.fields.type) || (PERSONAL_TYPES.some((t) => json.includes(t)) && belongsToAPerson(typeInJson(json)));
  personal.set(entry, answer);
  return answer;
}

function decide(json: string, typeField: string | undefined, view: EventView): string | null {
  let event: Json;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isObject(parsed)) return null;
    event = parsed;
  } catch {
    return null;
  }
  const type = typeof event.type === "string" ? event.type : typeField;
  if (belongsToAPerson(type)) return null;
  const wall = type ? (EVENT_WALLS as Record<string, EventWall | undefined>)[type] : undefined;
  if (!wall) return null;
  const payload = isObject(event.payload) ? event.payload : {};
  const sections = typeof wall.sections === "function" ? wall.sections(payload) : wall.sections;
  if (sections.some((s) => view.walled.has(s))) return null;
  const copy: Json = { ...payload };
  const redacted: Section[] = [];
  for (const [section, paths] of Object.entries(wall.hide ?? {}) as [Section, readonly string[]][]) {
    if (!view.walled.has(section)) continue;
    let touched = false;
    for (const path of paths) touched = removePath(copy, path) || touched;
    if (touched) redacted.push(section);
  }
  if (redacted.length === 0) return json;
  return JSON.stringify({ ...event, payload: copy, redacted: redacted.sort() });
}

/**
 * The event JSON this reader may receive for one `ev:` stream entry: the entry's own JSON (spliced into the frame
 * as is), a redacted copy, or null when the event belongs to a section the reader is walled from. A reader with no
 * walls takes the fast path: no parsing at all.
 */
export function viewEvent(entry: StreamEntry, view: EventView): string | null {
  const json = entry.fields.json ?? JSON.stringify(entry.fields);
  if (personAddressed(entry, json)) return null;
  if (view.walled.size === 0) return json;
  let byView = decided.get(entry);
  if (!byView) decided.set(entry, (byView = new Map()));
  const hit = byView.get(view.key);
  if (hit !== undefined) return hit;
  const out = decide(json, entry.fields.type, view);
  byView.set(view.key, out);
  return out;
}

/** The fields of an account event a person may read (the column grant of `account_events`): not the actor. */
const ACCOUNT_EVENT_FIELDS = ["id", "userId", "type", "occurredAt", "payload"] as const;

/**
 * The event JSON the owner of an `ae:<userId>` channel receives for one stream entry, or null. The authorizer has
 * already held the channel to its own account; this holds every entry to it as well, so nothing that is not this
 * person's own account event leaves on the channel, whatever was written to the stream:
 *   - the event must name this account as its `userId`;
 *   - its type must be account-scoped (a business event planted here goes nowhere), and agree with the entry's `type`;
 *   - only `ACCOUNT_EVENT_FIELDS` are sent (what the person may also select from the table; never the actor).
 */
export function viewAccountEvent(entry: StreamEntry, userId: string): string | null {
  const json = entry.fields.json;
  if (json === undefined) return null;
  let event: Json;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!isObject(parsed)) return null;
    event = parsed;
  } catch {
    return null;
  }
  if (typeof event.userId !== "string" || event.userId.toLowerCase() !== userId.toLowerCase()) return null;
  if (typeof event.type !== "string" || !isAccountEventType(event.type)) return null;
  if (entry.fields.type !== undefined && entry.fields.type !== event.type) return null;
  if (typeof event.id !== "string" || !isObject(event.payload)) return null;
  return JSON.stringify(Object.fromEntries(ACCOUNT_EVENT_FIELDS.map((field) => [field, event[field]])));
}

/** The staff member a `membership.changed` entry is about (apps/stream re-checks their subscriptions); null otherwise. */
export function membershipChangeOf(entry: StreamEntry): string | null {
  if (entry.fields.type !== "membership.changed") return null;
  try {
    const event: unknown = JSON.parse(entry.fields.json ?? "null");
    const userId = isObject(event) && isObject(event.payload) ? event.payload.userId : null;
    return typeof userId === "string" ? userId : null;
  } catch {
    return null;
  }
}
