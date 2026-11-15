import { describe, expect, it } from "vitest";
import { TEAM_CALL_LIMITS, type TeamCallTurnView } from "@foundmill/shared/team-call";
import { mergeTurns, newClientTurnId, shouldContinue, turnsToSpeakOnOpen, type DiscussInput } from "../turns";

const NOW = Date.parse("2026-11-12T15:10:00Z");
const turn = (seq: number, speaker: "founder" | "agent", ageMs = 1_000): TeamCallTurnView => ({
  id: `t${seq}`,
  seq,
  speaker,
  agentId: speaker === "agent" ? "a1" : null,
  userId: speaker === "founder" ? "u1" : null,
  text: `line ${seq}`,
  to: null,
  via: speaker === "founder" ? "typed" : null,
  createdAt: new Date(NOW - ageMs).toISOString(),
});

describe("mergeTurns", () => {
  it("adds the founder's turn and the replies in seq order, each once", () => {
    const base = [turn(1, "agent")];
    const merged = mergeTurns(base, { founderTurn: turn(2, "founder"), turns: [turn(3, "agent"), turn(4, "agent")] });
    expect(merged.map((t) => t.seq)).toEqual([1, 2, 3, 4]);
    // A retried send answers with the same turns.
    expect(mergeTurns(merged, { founderTurn: turn(2, "founder"), turns: [turn(3, "agent"), turn(4, "agent")] })).toHaveLength(4);
    expect(mergeTurns(base, { founderTurn: null, turns: [] })).toHaveLength(1);
  });
});

describe("turnsToSpeakOnOpen", () => {
  it("speaks the opening round of a call started just now", () => {
    expect(turnsToSpeakOnOpen([turn(1, "agent"), turn(2, "agent")], NOW).map((t) => t.id)).toEqual(["t1", "t2"]);
  });
  it("speaks only what came after the founder's last words", () => {
    expect(turnsToSpeakOnOpen([turn(1, "agent"), turn(2, "founder"), turn(3, "agent")], NOW).map((t) => t.id)).toEqual(["t3"]);
  });
  it("stays quiet on a call reopened long after", () => {
    expect(turnsToSpeakOnOpen([turn(1, "agent", 10 * 60_000)], NOW)).toEqual([]);
  });
});

describe("shouldContinue (Let the team discuss)", () => {
  const base: DiscussInput = { kind: "team", discussOn: true, live: true, handBack: false, agentRoundsSinceFounder: 0, busy: false, playbackIdle: true, founderActive: false };
  it("goes on when the team is quiet, the founder is silent and the switch is on", () => {
    expect(shouldContinue(base)).toBe(true);
  });
  it.each([
    ["the switch is off", { discussOn: false }],
    ["a one-to-one call", { kind: "one_to_one" as const }],
    ["the agents handed back", { handBack: true }],
    ["a round is being written", { busy: true }],
    ["an agent is still speaking", { playbackIdle: false }],
    ["the founder is speaking", { founderActive: true }],
    ["the call is ending", { live: false }],
    ["the round limit is reached", { agentRoundsSinceFounder: TEAM_CALL_LIMITS.agentRoundsWithoutFounder }],
  ] as const)("stops when %s", (_name, patch) => {
    expect(shouldContinue({ ...base, ...patch })).toBe(false);
  });
});

describe("newClientTurnId", () => {
  it("is unique and long enough for the api (8 to 64 characters)", () => {
    const a = newClientTurnId();
    expect(a).not.toBe(newClientTurnId());
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(64);
  });
});
