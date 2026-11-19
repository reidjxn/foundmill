/**
 * Section walls on business events (BUILD §11.9; security review S1): one table for every reader of the event log. The
 * stream (apps/stream `walls.ts`) applies it to `ev:<businessId>`; the api applies the same `hide` lists to the events
 * it reads under a person's own RLS connection (`cycle.status`, the Team's agent health), so a field the stream takes
 * out for a reader walled off Finance never comes back to them through a procedure (the collaborator's walls,
 * Nov 14, 2026). Every event type is filed here under the sections it belongs to:
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
 * here. Zod-free and pure, so a browser bundle may import it.
 */
import type { BusinessEventType } from "./constants";
import { walledSections, type Section, type SectionMembership } from "./permissions";

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
  "task.design_checked": { sections: ["development"], hide: freeText("result") },
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
  // The project's site (WP-07): ids, counts and addresses. A preview address is unlisted, so it is Product's like the
  // releases themselves; the live address is public anyway.
  "site.release_created": { sections: ["product"] },
  "site.published": { sections: ["product"] },
  "site.unpublished": { sections: ["product"] },
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
  "update.drafted": { sections: ["distribution"] },
  "update.sent": { sections: ["distribution"] },
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
  // The page quiz approved, turned on or off (0105): ids and its shape, never the words. The Public page tab follows.
  "quiz.approved": { sections: ["product"] },
  // The positioning notes approved (0118, WP-08 T1): the version and the names of the sections that changed, never the words.
  "positioning.approved": { sections: ["product"] },
  "quiz.published": { sections: ["product"] },
  "quiz.unpublished": { sections: ["product"] },
  // Invitations to the project: the People tab (Settings, under the Team section).
  "invitation.sent": { sections: ["team"] },
  "invitation.accepted": { sections: ["team"] },
  "invitation.declined": { sections: ["team"] },
  // Showcase videos (0103). In the house: its asks and the draft post they lead to (Customers › Creative). In a project:
  // that an ask went out and how it settled, ids and the overall state only, filed with Settings so that a collaborator
  // (who has none) hears nothing of the founders' ask.
  "showcase.requested": { sections: ["distribution"] },
  "showcase.approved": { sections: ["distribution"] },
  "showcase.withdrawn": { sections: ["distribution"] },
  "showcase.asked": { sections: ["settings"] },
  "showcase.settled": { sections: ["settings"] },
  // A shared post's link was opened for the first time, and a real outcome credited to a post (item 8): ids only, never
  // narrated, never counted toward the north star. Visits stay private, so the first is filed with the metrics-only
  // events; the second goes live only to someone who reads all of what a credited outcome can be (a follower or a reply is
  // the CRM's, a payment Finance's), so its type is never one a collaborator reads (0099's list, which leaves out a type
  // whose outcomes are not all readable). The Creative tab's line itself comes from the api, under the same walls per kind.
  "visit.attributed": { sections: ["settings"] },
  "post.outcome_attributed": { sections: ["distribution", "crm", "finance"] },
} as const satisfies { readonly [K in BusinessEventType]: EventWall };

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

/** The wall of an event type, or undefined for a type the table does not know. */
export const eventWallOf = (type: string | null | undefined): EventWall | undefined => (type ? (EVENT_WALLS as Record<string, EventWall | undefined>)[type] : undefined);

export interface RedactedEventPayload<P extends Json = Json> {
  /** The payload as the reader may see it: the original object when nothing was hidden, else a copy. */
  payload: P;
  /** The walls that took something out, sorted; empty when the payload is unchanged. */
  redacted: Section[];
}

/**
 * The payload of one event as a reader walled from `walled` may see it: every `hide` path of each walled section taken
 * out (the stream's `viewEvent` and the api's reads apply exactly this). A type the table does not know is returned as
 * it is: the stream withholds such an event whole, and the api only reads types it names.
 */
export function redactEventPayload<P extends Json>(type: string | null | undefined, payload: P, walled: ReadonlySet<Section> | readonly Section[]): RedactedEventPayload<P> {
  const walls = walled instanceof Set ? (walled as ReadonlySet<Section>) : new Set(walled as readonly Section[]);
  const hide = eventWallOf(type)?.hide;
  if (!hide || walls.size === 0) return { payload, redacted: [] };
  const copy: Json = { ...payload };
  const redacted: Section[] = [];
  for (const [section, paths] of Object.entries(hide) as [Section, readonly string[]][]) {
    if (!walls.has(section)) continue;
    let touched = false;
    for (const path of paths) touched = removePath(copy, path) || touched;
    if (touched) redacted.push(section);
  }
  return redacted.length === 0 ? { payload, redacted } : { payload: copy as P, redacted: redacted.sort() };
}

/** An event read from the log, as this member may read it: its payload cut by their walls (`redactEventPayload`). */
export function eventAsSeenBy<E extends { type: string; payload: unknown }>(membership: SectionMembership, event: E): E & { redacted: Section[] } {
  const payload = isObject(event.payload) ? event.payload : {};
  const out = redactEventPayload(event.type, payload, walledSections(membership));
  return { ...event, payload: out.payload as E["payload"], redacted: out.redacted };
}
