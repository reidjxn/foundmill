import { detectHardGates } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { NUDGE_MAX_LENGTH, nudgePresets } from "../nudges";
import { getTemplate } from "../registry";
import { ALL_TEMPLATES, chiefOfStaff } from "../templates";
import { AgentVoice } from "../types";
import { DEFAULT_VOICE, ackLine, deriveVoice, thinkingLine, voiceRegister } from "../voice";

const FOOTBALL = /\b(?:squad|dugout|whistle|club|crest|shout|bench|captain|kick[\s-]?off|match[\s-]?day|pitch|trophy|league|season|goal)\b/i;
const HUMAN = /\b(?:I(?:'m| am) (?:a )?(?:human|person)|at my desk|coffee|lunch|weekend)\b/i;

describe("agent voice (audit-conversation §3)", () => {
  it("every template carries a voice derived from its family and tone, free of football words and human claims", () => {
    for (const t of ALL_TEMPLATES) {
      expect(AgentVoice.safeParse(t.voice).success, t.key).toBe(true);
      const lines = [t.voice.greeting, ...t.voice.thinking, ...t.voice.ack];
      for (const l of lines) {
        expect(l, t.key).not.toMatch(FOOTBALL);
        expect(l, t.key).not.toMatch(HUMAN);
      }
      expect(t.voice).toEqual(deriveVoice({ family: t.family, tone: t.instructions.tone }));
    }
  });

  it("sounds like the agent: terse engineers, a calm Chief of Staff, a measured legal lead, silent utilities", () => {
    expect(voiceRegister("lead", getTemplate("engineering_lead").instructions.tone)).toBe("terse");
    expect(voiceRegister("worker", getTemplate("backend_engineer").instructions.tone)).toBe("terse");
    expect(voiceRegister("assistant", chiefOfStaff.instructions.tone)).toBe("calm");
    expect(voiceRegister("lead", getTemplate("legal_lead").instructions.tone)).toBe("measured");
    expect(voiceRegister("lead", getTemplate("finance_lead").instructions.tone)).toBe("numerate");
    expect(voiceRegister("lead", getTemplate("operations_lead").instructions.tone)).toBe("practical");
    expect(voiceRegister("utility", "Silent. JSON only.")).toBe("silent");
    expect(getTemplate("backend_engineer").voice.thinking).toContain("Checking the branch…");
    expect(chiefOfStaff.voice.thinking).toContain("Looking across the team…");
    expect(getTemplate("backend_engineer").voice).not.toEqual(chiefOfStaff.voice);
    expect(DEFAULT_VOICE.greeting.length).toBeGreaterThan(2);
  });

  it("the typing line names what the agent is looking at, otherwise speaks in its voice; both deterministic", () => {
    expect(thinkingLine(chiefOfStaff.voice, { lookingAt: "Carton artwork proof round 2" })).toBe("Checking carton artwork proof round 2…");
    expect(thinkingLine(chiefOfStaff.voice, { lookingAt: "PR 12 review" })).toBe("Checking PR 12 review…");
    expect(chiefOfStaff.voice.thinking).toContain(thinkingLine(chiefOfStaff.voice, { lookingAt: "Where should the first customer come from?" }));
    const a = thinkingLine(chiefOfStaff.voice, { seed: "thread-1" });
    expect(chiefOfStaff.voice.thinking).toContain(a);
    expect(thinkingLine(chiefOfStaff.voice, { seed: "thread-1" })).toBe(a);
    expect(chiefOfStaff.voice.ack).toContain(ackLine(chiefOfStaff.voice, "nudge-1"));
    expect(ackLine(chiefOfStaff.voice, "nudge-1")).toBe(ackLine(chiefOfStaff.voice, "nudge-1"));
  });

  it("the Chief of Staff's role is not duplicated", () => {
    expect(chiefOfStaff.instructions.role).not.toMatch(/Chief of Staff and Chief of Staff/);
    expect(chiefOfStaff.instructions.role.startsWith("Chief of Staff:")).toBe(true);
  });
});

describe("nudgePresets (audit-conversation finding 6)", () => {
  it("engineers get the engineering presets the api already accepts by name", () => {
    const p = nudgePresets("backend_engineer");
    expect(p.map((x) => x.label)).toEqual(["Focus on tests", "Simplify", "Ask before schema changes", "Match the design system", "Hurry up"]);
    expect(p.every((x) => x.apiPreset === x.label)).toBe(true);
  });

  it("a channel engine or a sourcing specialist is never told to focus on tests", () => {
    const influencer = nudgePresets(getTemplate("channel_influencer").agentType).map((x) => x.label);
    expect(influencer).not.toContain("Focus on tests");
    expect(influencer).toContain("Hold new spend");
    const sourcing = nudgePresets(getTemplate("sourcing_manufacturing").agentType).map((x) => x.label);
    expect(sourcing).not.toContain("Ask before schema changes");
    expect(sourcing).toContain("Get a second quote");
    expect(nudgePresets("chief_of_staff").map((x) => x.label)).toContain("Prioritise customers");
    expect(nudgePresets("custom_made_up_type").map((x) => x.label)).toContain("Cite your sources");
  });

  it("every preset fits the api limit, the chip, and never asks for a hard-gated action", () => {
    for (const t of ALL_TEMPLATES) {
      for (const p of nudgePresets(t.agentType)) {
        expect(p.text.length).toBeLessThanOrEqual(NUDGE_MAX_LENGTH);
        expect(p.label.length).toBeLessThanOrEqual(36);
        expect(p.key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(detectHardGates(p.text), `${t.key}: ${p.text}`).toEqual([]);
        expect(p.text).not.toMatch(FOOTBALL);
      }
    }
  });
});
