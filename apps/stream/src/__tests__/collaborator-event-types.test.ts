/**
 * 0098 — the business event types a collaborator may read in the database (`fm_collaborator_event_types()`, the select
 * policy of `events` and `outbox`) are the types the stream's walls deliver to a collaborator at all: `EVENT_WALLS`
 * files each type under sections, and a collaborator receives a type only when every section it can be filed under is
 * one a collaborator can read (@foundmill/shared `COLLABORATOR_SECTIONS`). The list is read from the latest migration
 * that defines the function, as it is spelled there, the same way rls/account-events.test.ts reads
 * `fm_account_event_types()`; packages/db rls/events-collaborator.test.ts holds the migrated database to the same text.
 */
import { readMigrations } from "@foundmill/db";
import { EVENTS, type StreamEntry } from "@foundmill/events";
import { EVENT_FIXTURES, fixtureId } from "@foundmill/events/testing/fixtures";
import { COLLABORATOR_SECTIONS, EVENT_TYPES, isAccountEventType, SECTIONS, type BusinessEventType, type Section } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { EVENT_WALLS, eventView, viewEvent, type EventWall } from "../walls";
import { BUSINESS_A } from "./helpers";

const COLLABORATOR = eventView({ role: "collaborator", sectionPermissions: {} });

/**
 * The payloads that reach each outcome of a wall whose sections depend on the payload. The only such wall today is a
 * desk conversation's (`conversationSections`: an Inbox note's is the Inbox's, any other subject the Team's); a new one
 * fails the test below until its outcomes are listed here.
 */
const PAYLOAD_OUTCOMES: Partial<Record<BusinessEventType, readonly Record<string, unknown>[]>> = {
  "conversation.message_posted": [{ subjectKind: "inbox_item" }, { subjectKind: "task" }, { subjectKind: "agent" }],
};

function sectionsOf(type: BusinessEventType): readonly Section[] {
  const wall: EventWall = EVENT_WALLS[type];
  if (typeof wall.sections !== "function") return wall.sections;
  const outcomes = PAYLOAD_OUTCOMES[type];
  if (!outcomes) throw new Error(`${type}: its sections depend on the payload; list the payloads of its outcomes in PAYLOAD_OUTCOMES`);
  const fn = wall.sections;
  return [...new Set(outcomes.flatMap((p) => fn(p)))];
}

/** The types a collaborator receives on the stream at all: every section the type can be filed under is readable. */
const expected = (Object.keys(EVENT_WALLS) as BusinessEventType[]).filter((type) => sectionsOf(type).every((s) => !COLLABORATOR.walled.has(s)));

/** Every definition of `fm_collaborator_event_types()` among the migrations, in the order they run. */
function definitions(): { tag: string; attributes: string; types: string[] }[] {
  const definition = /create (?:or replace )?function fm_collaborator_event_types\(\) returns text\[\]\s+([^$]*?)\s+as \$\$\s*select array\[([^\]]*)\]::text\[\]\s*\$\$;/g;
  return readMigrations().flatMap((m) =>
    [...m.sql.matchAll(definition)].map((found) => ({ tag: m.tag, attributes: found[1]!.replace(/\s+/g, " "), types: [...found[2]!.matchAll(/'([^']*)'/g)].map((t) => t[1]!) })),
  );
}

let seq = 0;
function entry(type: BusinessEventType, payload: Record<string, unknown>): StreamEntry {
  const id = fixtureId(`collab-${++seq}`);
  const event = { id, businessId: BUSINESS_A, type, occurredAt: "2026-11-14T09:00:00.000Z", actor: { kind: "system", id: "test" }, entityIds: [], payload, narrated: false };
  return { stream: `ev:${BUSINESS_A}`, id: `${seq}-0`, fields: { id, type, json: JSON.stringify(event) } };
}

describe("fm_collaborator_event_types() (0098) and the stream's walls", () => {
  const defs = definitions();
  const latest = defs.at(-1);

  it("is defined by a migration, immutable, reading nothing, with the fixed search path", () => {
    expect(defs.length).toBeGreaterThan(0);
    expect(latest!.attributes).toBe("language sql immutable parallel safe set search_path = pg_catalog, public, pg_temp");
  });

  it("the latest definition lists exactly the types EVENT_WALLS files only under sections a collaborator reads", () => {
    expect([...latest!.types].sort()).toEqual([...expected].sort());
    expect(new Set(latest!.types).size).toBe(latest!.types.length);
  });

  it("the walls the list is computed from are a collaborator's: Money, Legal, Billing, Settings and the network", () => {
    expect([...COLLABORATOR.walled].sort()).toEqual(SECTIONS.filter((s) => COLLABORATOR_SECTIONS[s] === "none").sort());
    expect([...COLLABORATOR.walled].sort()).toEqual(["billing", "finance", "legal", "live", "settings"]);
  });

  it("closes the Money, Legal and Settings types and keeps the Product and Distribution ones", () => {
    for (const closed of ["payment.received", "bank.balance_updated", "runway.threshold_crossed", "filing.due", "contract.signed", "credential.expiring", "guidance.tour_completed", "founder.session_started", "negotiation.message"] as const) {
      expect(latest!.types, closed).not.toContain(closed);
    }
    for (const open of ["spec.version_published", "page.published", "task.started", "lead.created", "mail.sent", "post.drafted", "membership.changed", "idea.committed"] as const) {
      expect(latest!.types, open).toContain(open);
    }
  });

  it("names business event types only, never an account-scoped one", () => {
    const business = new Set(EVENT_TYPES.filter((t) => !isAccountEventType(t)));
    for (const t of latest!.types) expect(business.has(t as BusinessEventType), t).toBe(true);
  });

  it("an event filed under several sections is listed only when every one of them is readable, as the stream decides", () => {
    // The stream withholds an event when any one of its sections is walled (viewEvent); the list follows the same rule.
    const mixed = { sections: ["product", "finance"] } as const satisfies EventWall;
    expect(mixed.sections.every((s) => !COLLABORATOR.walled.has(s))).toBe(false);
    expect([...sectionsOf("conversation.message_posted")].sort()).toEqual(["inbox", "team"]);
  });

  it("agrees with what the stream delivers to a collaborator, for every catalog fixture", () => {
    const listed = new Set(latest!.types);
    for (const type of Object.keys(EVENT_WALLS) as BusinessEventType[]) {
      if (!(type in EVENTS)) continue;
      const payloads = PAYLOAD_OUTCOMES[type]?.map((p) => ({ ...(EVENT_FIXTURES[type] as Record<string, unknown>), ...p })) ?? [EVENT_FIXTURES[type] as Record<string, unknown>];
      for (const payload of payloads) {
        const delivered = viewEvent(entry(type, payload), COLLABORATOR) !== null;
        // A person-addressed type is never delivered on a business stream, and is never a row of `events` (0060).
        if (type === "connection.requested" || type === "message.received") {
          expect(delivered, type).toBe(false);
          expect(listed.has(type), type).toBe(false);
          continue;
        }
        expect(listed.has(type), `${type} ${JSON.stringify(payload).slice(0, 60)}`).toBe(delivered);
      }
    }
  });
});
