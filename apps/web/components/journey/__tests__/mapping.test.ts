import { describe, expect, it } from "vitest";
import { buildReplaySchedule } from "@foundmill/dugout";
import { captainOf, customerFactsFor, entityKindsFor, journeyIdForConversion, nthOfKind, parseAgents, parseXcSeries, stageAgentMeta, standoutAgent, toStageJourney, toStageTouches, type JourneyRowLike } from "../mapping";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AG1 = id(901);
const AG2 = id(902);
const ENT = id(500);

const row: JourneyRowLike = {
  id: id(1),
  conversionId: id(2),
  touchIds: [id(11), id(12), id(13)],
  weights: { [id(11)]: 0.4, [id(12)]: 0.2, [id(13)]: 0.4 },
  xcSeries: [
    { index: 0, touchId: id(11), at: "2026-09-01T10:00:00.000Z", p: 0.1, cumulative: 0.1 },
    { index: 1, touchId: id(12), at: "2026-09-03T10:00:00.000Z", p: 0.2, cumulative: 0.3 },
    { bad: true },
  ],
  commentary: [{ text: "First touch.", touchId: null, highlight: false }, { text: "Win moment.", touchId: null, highlight: true }],
  agents: [
    { agentId: AG1, name: "Mara", role: "Lifecycle", departmentId: null, contribution: 0.6, touchIds: [id(12), id(13)], rating: 8 },
    { agentId: AG2, name: "Finn", role: "SEO", departmentId: null, contribution: 0.4, touchIds: [id(11)], rating: 7 },
    { nope: 1 },
  ],
  matchdayLevel: "cup",
  viewedAt: null,
  conversion: { id: id(2), entityId: ENT, kind: "payment", amountMinor: 49_900, currency: "EUR", occurredAt: new Date("2026-09-05T10:00:00.000Z") },
  touches: [
    { id: id(13), occurredAt: new Date("2026-09-04T10:00:00.000Z"), channelKey: "email_automation", kind: "email_click", source: { agentId: AG1 } },
    { id: id(11), occurredAt: new Date("2026-09-01T10:00:00.000Z"), channelKey: "seo", kind: "visit", source: { clickIds: { gclid: "x" } } },
    { id: id(12), occurredAt: new Date("2026-09-03T10:00:00.000Z"), channelKey: "email_automation", kind: "email_open", source: {} },
  ],
  entity: { id: ENT, displayName: "Acme Ltd", kind: "organisation" },
};

describe("journey.get → JourneyStage (AC-11.4.3 deterministic)", () => {
  it("sorts touches by time with ISO strings and marks third-party click ids as not first-party", () => {
    const t = toStageTouches(row.touches);
    expect(t.map((x) => x.id)).toEqual([id(11), id(12), id(13)]);
    expect(t[0]!.occurredAt).toBe("2026-09-01T10:00:00.000Z");
    expect(t[0]!.firstParty).toBe(false);
    expect(t[1]!.firstParty).toBe(true);
  });
  it("parses only valid xC points and agents", () => {
    expect(parseXcSeries(row.xcSeries)).toHaveLength(2);
    expect(parseAgents(row.agents).map((a) => a.name)).toEqual(["Mara", "Finn"]);
  });
  it("derives channels, captain, standout agent and stats from the record", () => {
    const touches = toStageTouches(row.touches);
    const j = toStageJourney(row, touches, { nthOfKind: 7, conversionCount: 12 });
    expect(j.channels.map((c) => [c.channelKey, Math.round(c.weight * 100), c.touchCount])).toEqual([
      ["email_automation", 60, 2],
      ["seo", 40, 1],
    ]);
    // Ties on weight go to the earliest touch; the agent comes from the agents' touch lists when the touch names none.
    expect(j.captain).toEqual({ touchId: id(11), channelKey: "seo", agentId: AG2, weight: 0.4 });
    expect(j.playerOfTheMatch).toBe(AG1);
    expect(j.stats).toMatchObject({ touchCount: 3, firstTouchAt: "2026-09-01T10:00:00.000Z", lastTouchAt: "2026-09-04T10:00:00.000Z", timeToConvertHours: 96, acquisitionCostMinor: null, currency: "EUR" });
    expect(j).toMatchObject({ kind: "payment", nthOfKind: 7, fullMatchDay: true, attributionModel: "position_based_40_20_40", xcModelSource: "archetype_prior", amountMinor: 49_900, convertedAt: "2026-09-05T10:00:00.000Z", matchdayLevel: "cup" });
    expect(captainOf([], {}, [])).toBeNull();
    expect(standoutAgent([])).toBeNull();
  });
  it("the same record always yields the same replay frames", () => {
    const touches = toStageTouches(row.touches);
    const a = buildReplaySchedule(toStageJourney(row, touches, { nthOfKind: 1 }), touches, "full");
    const shuffled = toStageTouches([...row.touches].reverse());
    const b = buildReplaySchedule(toStageJourney({ ...row, touches: [...row.touches].reverse() }, shuffled, { nthOfKind: 1 }), shuffled, "full");
    expect(a.hash).toBe(b.hash);
    expect(a.frames.length).toBeGreaterThan(6);
  });
  it("counts the nth of a kind from business-wide daily rows plus same-day conversions", () => {
    const rows = [
      { day: "2026-09-01", departmentId: null, signups: 1, activations: 0, payments: 3 },
      { day: "2026-09-01", departmentId: id(77), signups: 9, activations: 9, payments: 9 },
      { day: "2026-09-05", departmentId: null, signups: 0, activations: 0, payments: 2 },
    ];
    const sameDay = [
      { id: id(3), kind: "payment" as const, occurredAt: "2026-09-05T08:00:00.000Z" },
      { id: id(2), kind: "payment" as const, occurredAt: "2026-09-05T10:00:00.000Z" },
      { id: id(4), kind: "payment" as const, occurredAt: "2026-09-05T12:00:00.000Z" },
      { id: id(5), kind: "signup" as const, occurredAt: "2026-09-05T09:00:00.000Z" },
    ];
    expect(nthOfKind(row.conversion, rows, sameDay)).toBe(5);
    expect(nthOfKind(row.conversion, undefined, undefined)).toBe(1);
    expect(nthOfKind(row.conversion, [{ day: "2026-09-01", departmentId: "00000000-0000-0000-0000-000000000000", signups: 0, activations: 0, payments: 4 }], [])).toBe(5);
  });
  it("customer facts, team-sheet meta and entity kinds", () => {
    const touches = toStageTouches(row.touches);
    const j = toStageJourney(row, touches, { nthOfKind: 1 });
    const facts = customerFactsFor(row, j, touches, { identifiers: { domain: "acme.example" }, roles: [{ role: "customer" }] });
    expect(facts).toMatchObject({ name: "Acme Ltd", kind: "organisation", entityId: ENT });
    expect(facts.facts.map((f) => f.label)).toEqual(["Domain", "Role", "First touch", "Touches", "Time to convert"]);
    expect(facts.facts.find((f) => f.label === "Time to convert")?.value).toBe("4 days");
    expect(customerFactsFor({ ...row, entity: null }, j, touches).name).toBe("A new customer");
    const meta = stageAgentMeta(j.agents, [{ colourToken: "dept-2", squad: [{ id: AG1, avatarSeed: "seed-1", status: "working", modelKey: "sonnet" }] }]);
    expect(meta[0]).toEqual({ agentId: AG1, seed: "seed-1", dept: "dept-2", status: "working", model: "sonnet" });
    expect(meta[1]).toMatchObject({ agentId: AG2, seed: AG2, dept: "dept-3" });
    expect(entityKindsFor(row, j.agents)).toEqual({ [ENT]: "organisation", [AG1]: "agent", [AG2]: "agent" });
  });
  it("resolves a Ribbon marker's conversion id to its journey", () => {
    expect(journeyIdForConversion(id(2), [{ id: "j1", conversionId: id(2) }])).toBe("j1");
    expect(journeyIdForConversion(id(9), [{ id: "j1", conversionId: id(2) }])).toBeNull();
    expect(journeyIdForConversion(id(2), undefined)).toBeNull();
  });
});
