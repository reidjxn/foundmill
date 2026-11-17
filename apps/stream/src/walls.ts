/**
 * Section walls on `ev:<businessId>` (BUILD §11.9; security review S1). The api walls staff off sections with
 * `sectionRead(...)` and the Inbox redaction; the business stream carries the same facts as raw platform events, so
 * every event type is filed under the sections it belongs to, the same walls the procedures that serve it apply. The
 * table, `EVENT_WALLS`, lives in @foundmill/shared (`event-walls.ts`) since Nov 14, 2026, so the api cuts the same fields
 * from the events it reads under a person's own connection; it is re-exported here for the stream's own tests.
 *
 * An event of a type the table does not know (a newer writer during a deploy) reaches only readers without walls.
 *
 * One kind of event is walled from everyone: a person-addressed one (`PERSON_ADDRESSED_EVENT_TYPES`: a connection request
 * or a message from another founder). It is about its recipient, not the business, so it is never delivered on a business
 * stream, not even to the owner or to a reader without walls; the api no longer writes them to a business at all (FU-S-2)
 * and this keeps one that still arrives (an older api during a deploy, a stray writer) from reaching the staff.
 *
 * An account-scoped event (`ACCOUNT_EVENT_TYPES`: a fact about one person, such as their profile going public, or a
 * sign-up that a public page brought: `signup.attributed` for the new person, `referral.arrived` for the person
 * credited, or a founder notice Foundmill emailed them: `founder_notice.sent`, security review P2-3, whose reader may
 * have been removed from the project) is walled from every reader of a business stream in the same way, and has no line in the table: it is
 * never written to a business and never relayed to `ev:`. It travels on the person's own `ae:<userId>`, where
 * `viewAccountEvent` lets through only that person's own account events, cut to the fields a person may read of them.
 */
import type { StreamEntry } from "@foundmill/events";
import { ACCOUNT_EVENT_TYPES, EVENT_WALLS, eventWallOf, isAccountEventType, isPersonAddressedEvent, PERSON_ADDRESSED_EVENT_TYPES, redactEventPayload, SECTIONS, walledSections, type EventWall, type Section, type SectionMembership } from "@foundmill/shared";

export { EVENT_WALLS, type EventWall };

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
  const wall = eventWallOf(type);
  if (!wall) return null;
  const payload = isObject(event.payload) ? event.payload : {};
  const sections = typeof wall.sections === "function" ? wall.sections(payload) : wall.sections;
  if (sections.some((s) => view.walled.has(s))) return null;
  const { payload: copy, redacted } = redactEventPayload(type, payload, view.walled);
  if (redacted.length === 0) return json;
  return JSON.stringify({ ...event, payload: copy, redacted });
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
