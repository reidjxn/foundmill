import { describe, expect, it } from "vitest";
import { emptySession, reduceSessionEvents, type AgentSessionEvent } from "@foundmill/dugout";
import { seedFromRows } from "../session-store";
import { toTileAgent } from "../shared";
import { hasSpecialistData, parseSpecialistNote, specialistDataFromSession } from "../specialist-data";
import { AGENT_WREN, agents, sessions, sourcingEvents, tasks } from "./fixtures";

const sourcing = tasks[4]!;
const seed = seedFromRows({ task: sourcing, session: sessions[2], agent: toTileAgent(agents[2], AGENT_WREN) });

describe("parseSpecialistNote", () => {
  it("parses each structured note type and rejects everything else", () => {
    expect(parseSpecialistNote('specialist:{"type":"rfq_stage","stage":{"id":"quoted","label":"Quoted","count":7}}')).toEqual({ type: "rfq_stage", stage: { id: "quoted", label: "Quoted", count: 7 } });
    expect(parseSpecialistNote("Looked at 40 suppliers")).toBeNull();
    expect(parseSpecialistNote("specialist:{nope")).toBeNull();
    expect(parseSpecialistNote('specialist:{"type":"quote","quote":{"id":"q"}}')).toBeNull();
    expect(parseSpecialistNote('specialist:{"type":"weather"}')).toBeNull();
  });
});

describe("specialistDataFromSession", () => {
  it("folds structured notes into funnel, quotes, samples and shipments", () => {
    const session = reduceSessionEvents(seed, sourcingEvents());
    const data = specialistDataFromSession(session);
    expect(data.rfq.map((s) => s.count)).toEqual([40, 22, 5]);
    expect(data.quotes).toHaveLength(1);
    expect(data.quotes[0]).toMatchObject({ supplier: "Baltic Pack OÜ", score: 15, status: "shortlisted" });
    expect(data.samples[0]?.stage).toBe("shipped");
    expect(data.shipments[0]?.ref).toBe("NWS-2026-017");
    expect(hasSpecialistData(data)).toBe(true);
  });

  it("replaces a record by id instead of duplicating it", () => {
    const events: AgentSessionEvent[] = [...sourcingEvents(), { kind: "note", at: "2026-10-07T09:30:00Z", source: "agent", text: 'specialist:{"type":"quote","quote":{"id":"q-1","supplier":"Baltic Pack OÜ","unitPrice":{"amountMinor":40,"currency":"EUR"},"moq":1000,"leadTimeDays":28,"score":17,"status":"accepted"}}' }];
    const data = specialistDataFromSession(reduceSessionEvents(seed, events));
    expect(data.quotes).toHaveLength(1);
    expect(data.quotes[0]?.status).toBe("accepted");
  });

  it("counts supplier tool calls into the funnel when no structured funnel arrived", () => {
    const events: AgentSessionEvent[] = [
      { kind: "tool_call", at: "2026-10-07T09:21:00Z", callId: "c1", tool: "search_suppliers", status: "succeeded" },
      { kind: "tool_call", at: "2026-10-07T09:22:00Z", callId: "c2", tool: "send_rfq", status: "succeeded" },
      { kind: "tool_call", at: "2026-10-07T09:23:00Z", callId: "c3", tool: "send_rfq", status: "failed" },
    ];
    const data = specialistDataFromSession(reduceSessionEvents(seed, events));
    expect(data.rfq.find((s) => s.id === "identified")?.count).toBe(1);
    expect(data.rfq.find((s) => s.id === "contacted")?.count).toBe(1);
  });

  it("is empty for a fresh session", () => {
    const data = specialistDataFromSession(emptySession(seed));
    expect(hasSpecialistData(data)).toBe(false);
  });
});
