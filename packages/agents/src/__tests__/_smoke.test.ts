import { it } from "vitest";
import { createModelClient } from "@foundmill/models";
import { buildTeamCallTurnRequest, finaliseTeamCallTurns, teamCallTurnsContext, buildTeamCallWrapUpRequest, finaliseTeamCallWrapUp, teamCallWrapUpContext, type TeamCallTurnInput } from "../prompts/team-call";
const COS = "11111111-1111-4111-8111-111111111111", PL = "22222222-2222-4222-8222-222222222222", MK = "33333333-3333-4333-8333-333333333333";
const participants = [
  { id: COS, displayName: "Chief of Staff", role: "Chief of Staff", departmentName: null, remit: "I run the team so you only read and decide.", isChiefOfStaff: true, voice: { greeting: "Hi.", ack: ["Got it.", "Noted."] } },
  { id: PL, displayName: "Product Lead", role: "Product lead", departmentName: "Product", remit: "I turn your idea into a specification and a roadmap for what to build first.", voice: { greeting: "Hi.", ack: ["Understood."] } },
  { id: MK, displayName: "Distribution Strategist", role: "Distribution strategist", departmentName: "Marketing", remit: "I pick the channels that reach your first customers and plan the launch email.", voice: { greeting: "Hi.", ack: ["Got it."] } },
];
it("smoke", async () => {
  const client = createModelClient({ mode: "mock" });
  const base: TeamCallTurnInput = { business: { name: "Shiftly", currency: "GBP", stage: "project" }, founderName: "Sam", participants, kind: "team", mode: "opening", topic: null, transcript: [] };
  for (const input of [base, { ...base, mode: "founder_spoke" as const, transcript: [{ speaker: "founder" as const, agentId: null, text: "How do we reach our first customers with a launch email?" }] }, { ...base, mode: "continue" as const, transcript: [{ speaker: "founder" as const, agentId: null, text: "How do we reach our first customers?" }, { speaker: "agent" as const, agentId: MK, text: "x" }] }, { ...base, kind: "one_to_one" as const, participants: [participants[1]!], mode: "founder_spoke" as const, transcript: [{ speaker: "founder" as const, agentId: null, text: "What should the roadmap have first?" }] }]) {
    const req = buildTeamCallTurnRequest(input);
    const r = await client.complete(req);
    console.log(JSON.stringify(finaliseTeamCallTurns(r.json, teamCallTurnsContext(input)), null, 1));
  }
  const wu = { business: { name: "Shiftly", currency: "GBP" }, founderName: "Sam", participants, kind: "team" as const, transcript: [{ speaker: "founder" as const, agentId: null, text: "Let's build a waitlist page. Add a referral program to the roadmap. Spend up to £200 on Instagram ads next month. Pay the designer invoice." }], agents: participants.map((p) => ({ id: p.id, name: p.displayName, role: p.role, departmentName: p.departmentName })), roadmap: [{ id: "44444444-4444-4444-8444-444444444444", title: "Shift booking", horizon: "now" as const }] };
  const r = await client.complete(buildTeamCallWrapUpRequest(wu));
  console.log(JSON.stringify(finaliseTeamCallWrapUp(r.json, teamCallWrapUpContext(wu)), null, 1));
});
