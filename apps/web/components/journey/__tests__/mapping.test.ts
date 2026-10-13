import { describe, expect, it } from "vitest";
import { buildReplaySchedule } from "@foundmill/dugout";
import type { Journey as JourneyRecord } from "@foundmill/journey";
import { CHANNEL_META } from "@foundmill/shared";
import { customerFactsFor, entityKindsFor, replayOrigin, stageAgentMeta, stageJourneyFromRecord, toStageTouches, type JourneyRowLike } from "../mapping";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AG1 = id(901);
const AG2 = id(902);
const ENT = id(500);

const row: JourneyRowLike = {
  conversion: { id: id(2), entityId: ENT, kind: "payment", amountMinor: 49_900, currency: "EUR", occurredAt: new Date("2026-09-05T10:00:00.000Z") },
  entity: { id: ENT, displayName: "Acme Ltd", kind: "organisation" },
  viewedAt: null,
};

const touchRows = [
  { id: id(13), occurredAt: new Date("2026-09-04T10:00:00.000Z"), channelKey: "email_automation" as const, kind: "email_click", source: { agentId: AG1 } },
  { id: id(11), occurredAt: new Date("2026-09-01T10:00:00.000Z"), channelKey: "seo" as const, kind: "visit", source: { clickIds: { gclid: "x" } } },
  { id: id(12), occurredAt: new Date("2026-09-03T10:00:00.000Z"), channelKey: "email_automation" as const, kind: "email_open", source: {} },
];

/** What `journey.get` returns as `journey`: the full record, built and validated server-side. */
const record: JourneyRecord = {
  id: id(1),
  conversionId: id(2),
  entityId: ENT,
  kind: "payment",
  touchIds: [id(11), id(12), id(13)],
  weights: { [id(11)]: 0.4, [id(12)]: 0.2, [id(13)]: 0.4 },
  xcSeries: [
    { index: 0, touchId: id(11), at: "2026-09-01T10:00:00.000Z", p: 0.1, cumulative: 0.1 },
    { index: 1, touchId: id(12), at: "2026-09-03T10:00:00.000Z", p: 0.2, cumulative: 0.3 },
  ],
  commentary: [{ text: "First touch.", touchId: null, highlight: false }, { text: "Win moment.", touchId: null, highlight: true }],
  agents: [
    { agentId: AG1, name: "Mara", role: "Lifecycle", departmentId: null, contribution: 0.6, touchIds: [id(12), id(13)], rating: 8 },
    { agentId: AG2, name: "Finn", role: "SEO", departmentId: null, contribution: 0.4, touchIds: [id(11)], rating: 7 },
  ],
  matchdayLevel: "cup",
  viewedAt: null,
  channels: [
    { channelKey: "email_automation", weight: 0.6, touchCount: 2 },
    { channelKey: "seo", weight: 0.4, touchCount: 1 },
  ],
  captain: { touchId: id(13), channelKey: "email_automation", agentId: AG1, weight: 0.4 },
  playerOfTheMatch: AG1,
  attributionModel: "position_based_40_20_40",
  xcModelSource: "archetype_prior",
  consent: "granted",
  partialJourney: false,
  nthOfKind: 7,
  fullMatchDay: true,
  stats: { touchCount: 3, firstTouchAt: "2026-09-01T10:00:00.000Z", lastTouchAt: "2026-09-04T10:00:00.000Z", timeToConvertHours: 96, acquisitionCostMinor: 1_250, currency: "EUR" },
  convertedAt: "2026-09-05T10:00:00.000Z",
};

describe("journey.get → JourneyStage (AC-11.4.3 deterministic)", () => {
  it("sorts touches by time with ISO strings; click ids mark a touch third-party unless the record already says", () => {
    const t = toStageTouches(touchRows);
    expect(t.map((x) => x.id)).toEqual([id(11), id(12), id(13)]);
    expect(t[0]!.occurredAt).toBe("2026-09-01T10:00:00.000Z");
    expect(t[0]!.firstParty).toBe(false);
    expect(t[1]!.firstParty).toBe(true);
    expect(toStageTouches([{ ...touchRows[1]!, firstParty: true }])[0]!.firstParty).toBe(true);
  });

  it("renders the server record as it is: nothing is re-derived, the conversion adds amount and currency", () => {
    const j = stageJourneyFromRecord(record, row);
    expect(j).toMatchObject({
      id: id(1),
      kind: "payment",
      nthOfKind: 7,
      fullMatchDay: true,
      attributionModel: "position_based_40_20_40",
      xcModelSource: "archetype_prior",
      consent: "granted",
      partialJourney: false,
      amountMinor: 49_900,
      currency: "EUR",
      convertedAt: "2026-09-05T10:00:00.000Z",
      matchdayLevel: "cup",
      viewedAt: null,
    });
    expect(j.captain).toEqual(record.captain);
    expect(j.playerOfTheMatch).toBe(AG1);
    expect(j.channels).toEqual(record.channels);
    expect(j.stats.acquisitionCostMinor).toBe(1_250);
    expect(stageJourneyFromRecord({ ...record, viewedAt: null }, { ...row, viewedAt: new Date("2026-09-06T00:00:00.000Z") }).viewedAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("the same record always yields the same replay frames", () => {
    const touches = toStageTouches(touchRows);
    const a = buildReplaySchedule(stageJourneyFromRecord(record, row), touches, "full");
    const shuffled = toStageTouches([...touchRows].reverse());
    const b = buildReplaySchedule(stageJourneyFromRecord({ ...record, touchIds: [...record.touchIds].reverse() }, row), shuffled, "full");
    expect(a.hash).toBe(b.hash);
    expect(a.frames.length).toBeGreaterThan(6);
  });

  it("customer facts, who-was-involved meta and entity kinds", () => {
    const touches = toStageTouches(touchRows);
    const j = stageJourneyFromRecord(record, row);
    const facts = customerFactsFor(row, j, touches, { identifiers: { domain: "acme.example" }, roles: [{ role: "customer" }] });
    expect(facts).toMatchObject({ name: "Acme Ltd", kind: "organisation", entityId: ENT });
    expect(facts.facts.map((f) => f.label)).toEqual(["Domain", "Role", "First touch", "Touches", "Time to convert"]);
    expect(facts.facts.find((f) => f.label === "Time to convert")?.value).toBe("4 days");
    expect(customerFactsFor({ ...row, entity: null }, j, touches).name).toBe("A new customer");
    expect(customerFactsFor(row, { ...j, partialJourney: true }, touches).facts.find((f) => f.label === "Touches")?.value).toBe("3 (consented touches only)");
    const meta = stageAgentMeta(j.agents, [{ colourToken: "dept-2", squad: [{ id: AG1, avatarSeed: "seed-1", status: "working", modelKey: "sonnet" }] }]);
    expect(meta[0]).toEqual({ agentId: AG1, seed: "seed-1", dept: "dept-2", status: "working", model: "sonnet" });
    expect(meta[1]).toMatchObject({ agentId: AG2, seed: AG2, dept: "dept-3" });
    expect(entityKindsFor(row, j.agents)).toEqual({ [ENT]: "organisation", [AG1]: "agent", [AG2]: "agent" });
  });

  it("reads stored keys as words in the customer rail: the role and the first channel by its name", () => {
    const touches = toStageTouches(touchRows);
    const j = stageJourneyFromRecord(record, row);
    const facts = customerFactsFor(row, j, touches, { roles: [{ role: "design_partner" }] });
    expect(facts.facts.find((f) => f.label === "Role")?.value).toBe("Design partner");
    expect(facts.facts.find((f) => f.label === "First touch")?.value).toBe(CHANNEL_META[touches[0]!.channelKey!].label);
    const seo = toStageTouches([{ ...touchRows[0]!, channelKey: "seo" }]);
    expect(customerFactsFor(row, j, seo, { roles: [{ role: "customer" }] }).facts.map((f) => f.value)).toEqual(expect.arrayContaining(["Customer", "SEO"]));
    expect(customerFactsFor(row, j, [], null).facts.find((f) => f.label === "First touch")?.value).toBe("Direct");
  });

  it("goes back to where the replay was opened from, and only inside this business", () => {
    const B = "b1e5e5e5-0000-4000-8000-000000000001";
    const departments = [{ slug: "growth", tabs: [{ slug: "attribution", title: "Attribution" }] }];
    expect(replayOrigin(null, B)).toEqual({ href: `/b/${B}/inbox`, label: "Inbox" });
    expect(replayOrigin(`/b/${B}/crm/${id(1)}/journey`, B)).toEqual({ href: `/b/${B}/crm/${id(1)}/journey`, label: "CRM profile" });
    expect(replayOrigin(`/b/${B}/milestones`, B)).toEqual({ href: `/b/${B}/milestones`, label: "Milestones" });
    expect(replayOrigin(`/b/${B}/home`, B).label).toBe("Home");
    expect(replayOrigin(`/b/${B}/d/growth/attribution`, B, departments)).toEqual({ href: `/b/${B}/d/growth/attribution`, label: "Attribution" });
    // Anything unknown, foreign or absolute falls back to the Inbox: the from path is never an open redirect.
    for (const bad of [`/b/${B}/d/growth/unknown`, `/b/other/crm`, "https://evil.example/b/x", `//evil.example/b/${B}/crm`, `/b/${B}//evil.example`, `/b/${B}/crm\\x`, `/b/${B}/crm/../../other`, `/b/${B}/milestones/..`]) expect(replayOrigin(bad, B, departments)).toEqual({ href: `/b/${B}/inbox`, label: "Inbox" });
  });
});
