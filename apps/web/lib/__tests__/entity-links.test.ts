import { describe, expect, it } from "vitest";
import { AGENT_VERBS, RECORD_VERBS, agentDetails, entityHref, recordDetails } from "../entity-links";
import { verbHref } from "../entity-resolver";
import { entityPaletteItems } from "../search";

const BID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_RECORD_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";

describe("where an entity mention goes (audit GTM-19, VFR3-X1)", () => {
  it("opens an agent's profile for the agent's id and for the agent's CRM record, and the CRM profile for anything else", () => {
    const isAgent = (id: string) => id === AGENT_ID;
    expect(entityHref(BID, { id: AGENT_ID }, isAgent)).toBe(`/b/${BID}/agents/${AGENT_ID}/overview`);
    // The record carries the agent it stands for: the link goes to the agent, never to /crm/<record id>.
    expect(entityHref(BID, { id: AGENT_RECORD_ID, kind: "agent", agentId: AGENT_ID }, isAgent)).toBe(`/b/${BID}/agents/${AGENT_ID}/overview`);
    expect(entityHref(BID, { id: PERSON_ID, kind: "person" }, isAgent)).toBe(`/b/${BID}/crm/${PERSON_ID}/overview`);
    expect(entityHref(BID, { id: PERSON_ID })).toBe(`/b/${BID}/crm/${PERSON_ID}/overview`);
  });

  it("the palette's records route the same way", () => {
    const items = entityPaletteItems(BID, [
      { entity: { id: AGENT_RECORD_ID, kind: "agent", displayName: "Chief of Staff", agentId: AGENT_ID }, score: 1, matchedOn: "name" },
      { entity: { id: PERSON_ID, kind: "person", displayName: "Sara Lindqvist" }, score: 1, matchedOn: "name" },
    ]);
    expect(items.map((i) => i.href)).toEqual([`/b/${BID}/agents/${AGENT_ID}/overview`, `/b/${BID}/crm/${PERSON_ID}/overview`]);
  });
});

describe("the hover card (audit GTM-26)", () => {
  it("an agent's card has its role, department, status and model, and Message / Open profile", () => {
    const d = agentDetails(BID, { id: AGENT_ID, name: "Scout", role: "SEO specialist", status: "working", modelKey: "sonnet", avatarSeed: "scout", departmentName: "Distribution", dept: "dept-3" });
    expect(d).toMatchObject({ id: AGENT_ID, kind: "agent", name: "Scout", subtitle: "SEO specialist", href: `/b/${BID}/agents/${AGENT_ID}/overview` });
    expect(d.facts).toEqual([{ label: "Department", value: "Distribution" }, { label: "Status", value: "Working" }, { label: "Model", value: "sonnet" }]);
    expect(d.verbs).toEqual(AGENT_VERBS);
  });

  it("an agent's card carries its persona key and position, for the first name and the AI agent marker", () => {
    const d = agentDetails(BID, { id: AGENT_ID, name: "Scout", role: "SEO specialist", avatarSeed: "scout", dept: "dept-3", personaKey: "malik" });
    expect(d).toMatchObject({ personaKey: "malik", role: "SEO specialist", name: "Scout", portrait: { type: "agent", personaKey: "malik" } });
    expect(agentDetails(BID, { id: AGENT_ID, name: "Scout" })).toMatchObject({ personaKey: null, role: null });
  });

  it("a record's card has its roles as chips, up to three facts, and the four right-click verbs", () => {
    const d = recordDetails(BID, { id: PERSON_ID, kind: "organisation", displayName: "Pennine Contract Cosmetics", agentId: null, email: "buy@pennine.example", domain: "pennine.example", roles: [{ role: "customer", stage: "won" }, { role: "supplier", stage: null }] });
    expect(d.chips).toEqual([{ label: "Customer" }, { label: "Supplier" }]);
    expect(d.facts).toEqual([{ label: "Stage", value: "Won" }, { label: "Email", value: "buy@pennine.example" }, { label: "Domain", value: "pennine.example" }]);
    expect(d.verbs).toEqual(RECORD_VERBS);
    expect(d.href).toBe(`/b/${BID}/crm/${PERSON_ID}/overview`);
  });

  it("right-click verbs go to the profile, the activity, or the role dialog", () => {
    expect(verbHref(BID, "open_profile", PERSON_ID)).toBe(`/b/${BID}/crm/${PERSON_ID}/overview`);
    expect(verbHref(BID, "message", PERSON_ID)).toContain(`/crm/${PERSON_ID}/activity`);
    expect(verbHref(BID, "assign_agent", PERSON_ID)).toBe(`/b/${BID}/crm/${PERSON_ID}/overview?role=1`);
    expect(verbHref(BID, "add_to_list", PERSON_ID)).toBe(`/b/${BID}/crm/${PERSON_ID}/overview?role=1`);
  });
});
