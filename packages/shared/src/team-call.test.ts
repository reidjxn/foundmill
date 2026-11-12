import { describe, expect, it } from "vitest";
import { PERSONAS } from "./personas";
import { assignSpeechAccents, spokenText, teamCallActionsLine, SPEECH_ACCENTS, speechAccentPresentation, speechAccent } from "./team-call";

const agent = (id: string, personaKey: string, day: number) => ({ id, personaKey, createdAt: new Date(Date.UTC(2026, 10, day)) });

describe("voice slots", () => {
  it("has unique keys and both presentations", () => {
    expect(new Set(SPEECH_ACCENTS.map((s) => s.key)).size).toBe(SPEECH_ACCENTS.length);
    expect(SPEECH_ACCENTS.some((s) => s.presentation === "woman")).toBe(true);
    expect(SPEECH_ACCENTS.some((s) => s.presentation === "man")).toBe(true);
  });
});

describe("assignSpeechAccents", () => {
  const women = PERSONAS.filter((p) => p.presentation === "woman").slice(0, 5);
  const men = PERSONAS.filter((p) => p.presentation === "man").slice(0, 5);
  const team = [...women.map((p, i) => agent(`a${i}`, p.key, i + 1)), ...men.map((p, i) => agent(`b${i}`, p.key, i + 10))];

  it("gives every agent a voice that matches its persona, unique while slots last", () => {
    const voices = assignSpeechAccents(team);
    expect(voices.size).toBe(team.length);
    expect(new Set(voices.values()).size).toBe(team.length);
    for (const a of team) expect(speechAccent(voices.get(a.id))?.presentation).toBe(speechAccentPresentation(a));
  });

  it("is deterministic and keeps existing voices when someone is hired later", () => {
    const before = assignSpeechAccents(team);
    const after = assignSpeechAccents([...team, agent("late", PERSONAS[40]!.key, 30)]);
    for (const a of team) expect(after.get(a.id)).toBe(before.get(a.id));
    expect(assignSpeechAccents([...team].reverse())).toEqual(before);
  });

  it("lets the founder choose one agent's accent without moving anyone else's", () => {
    const before = assignSpeechAccents(team);
    const chosen = team.map((a, i) => (i === 0 ? { ...a, speechAccent: "kaelen" } : a));
    const after = assignSpeechAccents(chosen);
    expect(after.get(team[0]!.id)).toBe("kaelen");
    for (const a of team.slice(1)) expect(after.get(a.id)).toBe(before.get(a.id));
    expect(assignSpeechAccents([{ ...team[0]!, speechAccent: "not-an-accent" }]).get(team[0]!.id)).toBe(assignSpeechAccents([team[0]!]).get(team[0]!.id));
  });

  it("repeats voices only past the slots of one presentation", () => {
    const many = PERSONAS.filter((p) => p.presentation === "woman").slice(0, 12).map((p, i) => agent(`w${i}`, p.key, i + 1));
    const voices = assignSpeechAccents(many);
    const womenSlots = SPEECH_ACCENTS.filter((s) => s.presentation === "woman").length;
    expect(new Set(voices.values()).size).toBe(womenSlots);
  });
});

describe("spokenText", () => {
  it("names teammates as the listener reads them and drops what cannot be spoken", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    expect(spokenText(`**Agreed.** [[ent:${id}|Product lead]], see https://x.example/a`, () => "Mira")).toBe("Agreed. Mira, see the link");
  });
});

describe("teamCallActionsLine", () => {
  it("counts by status", () => {
    expect(teamCallActionsLine([])).toBe("Nothing to file from this call.");
    expect(teamCallActionsLine([{ status: "filed" }, { status: "filed" }, { status: "awaiting_go_ahead" }])).toBe("2 filed · 1 needs your go-ahead");
  });
});
