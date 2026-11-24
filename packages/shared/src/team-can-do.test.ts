import { describe, expect, it } from "vitest";
import { BUSINESS_MODES } from "./constants";
import {
  TEAM_CAN_DO_ALWAYS_YOURS, TEAM_CAN_DO_OPTIONS, TEAM_CAN_DO_SETTINGS_HINT, TEAM_CAN_DO_AGENTS_STATEMENT, agentsWithOwnSettingLine, eachAgentLimitLabel, recommendedSpendLineMinor,
  spendAmountWords, spendLineInForceMinor, spendLineKind, spendLineSoonerNote, teamCanDoOption, teamCanDoOptionDescription, teamCanDoWords,
} from "./team-can-do";

const AGENT = 25_000;
const LINES = [null, 0, 5_000, 100_000] as const;
const CURRENCIES = ["GBP", "USD", "SEK", "JPY"] as const;
/** Words the page and the chip never say to a founder (docs/DESIGN.md §10, "the voice" 3). */
const PLUMBING = /\b(policy|policies|caps?|hard gates?|engine|cedar|threshold)\b/i;
/** British spellings and day-first dates (scripts/us-english.mjs). */
const BRITISH = /\b(colour|organis|judgement|centre|behaviour|labelled|cancelled|licence|defence|grey)/i;

describe("what the team can do: the words", () => {
  it("offers three answers, the middle one recommended, in the mode order", () => {
    expect(TEAM_CAN_DO_OPTIONS.map((o) => o.mode)).toEqual([...BUSINESS_MODES]);
    expect(TEAM_CAN_DO_OPTIONS.filter((o) => o.recommended).map((o) => o.mode)).toEqual(["assisted"]);
    // The Chief of Staff answering stays bundled in the third answer (founder, 2026-11-07: no separate row yet).
    expect(teamCanDoOption("automated").label).toBe("Work and decide on its own; the Chief of Staff answers routine questions for you");
    for (const o of TEAM_CAN_DO_OPTIONS) expect(o.promises.spendOverLine).toBe("ask");
  });

  it("formats the line in the business's own currency and narrow symbol, without decimals when whole", () => {
    expect(spendAmountWords(5_000, "GBP")).toBe("£50");
    expect(spendAmountWords(5_050, "GBP")).toBe("£50.50");
    expect(spendAmountWords(100_000, "USD")).toBe("$1,000");
    expect(spendAmountWords(5_000, "SEK")).toBe("kr\u00a050");
    expect(spendAmountWords(5_000, "JPY")).toBe("¥5,000");
  });

  it("names the null answer with the real default, so it never reads as no limit", () => {
    expect(eachAgentLimitLabel({ currency: "GBP", agentLimitMinor: AGENT })).toBe("Each agent's own limit (£250 unless you set one)");
    expect(eachAgentLimitLabel({ currency: "USD", agentLimitMinor: AGENT })).toBe("Each agent's own limit ($250 unless you set one)");
    expect(eachAgentLimitLabel({ agentLimitMinor: AGENT })).toBe("Each agent's own limit");
    expect([spendLineKind(null), spendLineKind(undefined), spendLineKind(0), spendLineKind(1)]).toEqual(["agent", "agent", "always", "amount"]);
  });

  it("suggests a line per answer and says the line in force is never above the agents' own limit", () => {
    expect(BUSINESS_MODES.map((m) => recommendedSpendLineMinor(m, AGENT))).toEqual([0, 25_000, 100_000]);
    expect(spendLineInForceMinor(null, AGENT)).toBe(AGENT);
    expect(spendLineInForceMinor(0, AGENT)).toBe(0);
    expect(spendLineInForceMinor(5_000, AGENT)).toBe(5_000);
    expect(spendLineInForceMinor(100_000, AGENT)).toBe(AGENT);
    expect(spendLineSoonerNote({ lineMinor: 100_000, currency: "GBP", agentLimitMinor: AGENT })).toBe("An agent still asks above its own limit when that is lower: £250 unless you set one on its Autonomy tab.");
    expect(spendLineSoonerNote({ lineMinor: 25_000, currency: "GBP", agentLimitMinor: AGENT })).toBeNull();
    expect(spendLineSoonerNote({ lineMinor: null, currency: "GBP", agentLimitMinor: AGENT })).toBeNull();
  });

  it("reads the chip per the table: Assisted, Augmented and Automated, at both widths", () => {
    const w = (mode: (typeof BUSINESS_MODES)[number], lineMinor: number | null, holiday = false) => teamCanDoWords({ mode, lineMinor, currency: "GBP", agentLimitMinor: AGENT, holiday });
    expect(w("assisted", 5_000)).toMatchObject({ label: "Asks before spending over £50", brief: "Asks over £50", ariaLabel: "What the team can do: asks before spending over £50" });
    expect(w("assisted", 0)).toMatchObject({ label: "Asks before any spending", brief: "Asks before spending" });
    expect(w("assisted", null)).toMatchObject({ label: "Asks before spending over each agent's limit", brief: "Asks before spending" });
    expect(w("augmented", 5_000)).toMatchObject({ label: "Asks before acting", brief: "Asks first" });
    expect(w("automated", 100_000)).toMatchObject({ label: "Decides alone, asks over £1,000", brief: "Asks over £1,000" });
    expect(w("automated", null)).toMatchObject({ label: "Decides alone, asks over each agent's limit", brief: "Decides alone" });
    expect(w("assisted", 5_000).tooltip).toBe(`The team does routine work on its own. It asks you before spending over £50, before anything it can't undo and before any contract. Moving money, signing and filings always come to you. ${TEAM_CAN_DO_SETTINGS_HINT}`);
    expect(w("augmented", 5_000).tooltip).toBe(`The team prepares the work and asks you before contacting anyone, spending anything or doing what can't be undone. Moving money, signing and filings always come to you. ${TEAM_CAN_DO_SETTINGS_HINT}`);
    expect(w("automated", 100_000).tooltip).toBe(`The team works and decides on its own, and the Chief of Staff answers routine questions for you. It still asks you before spending over £1,000. An agent asks sooner if its own limit is lower (£250 unless you set one). Moving money, signing and filings always come to you. ${TEAM_CAN_DO_SETTINGS_HINT}`);
    expect(w("assisted", null).tooltip).toContain("before spending over each agent's own limit (£250 unless you set one)");
    expect(TEAM_CAN_DO_SETTINGS_HINT).toBe("Change it in Settings › What the team can do.");
  });

  it("on vacation says the vacation's words and what comes back with the founder", () => {
    const away = teamCanDoWords({ mode: "assisted", lineMinor: 5_000, currency: "GBP", agentLimitMinor: AGENT, holiday: true });
    expect(away.label).toBe("Decides alone, asks over £50");
    expect(away.ariaLabel).toBe("What the team can do: decides alone, asks over £50, on vacation; asks before spending over £50 when you come back");
    expect(away.tooltip).toMatch(/^On vacation\. The team works and decides on its own, and the Chief of Staff decides inside the authority you set\. .* Back to: asks before spending over £50\.$/);
    const automated = teamCanDoWords({ mode: "automated", lineMinor: 5_000, currency: "GBP", agentLimitMinor: AGENT, holiday: true });
    expect(automated.ariaLabel).toBe("What the team can do: decides alone, asks over £50, on vacation");
    expect(automated.tooltip).not.toContain("Back to");
  });

  it("every mode × line × currency × vacation reads in plain US English, names the currency, and never claims more than the line", () => {
    for (const mode of BUSINESS_MODES) {
      for (const lineMinor of LINES) {
        for (const currency of CURRENCIES) {
          for (const holiday of [false, true]) {
            const words = teamCanDoWords({ mode, lineMinor, currency, agentLimitMinor: AGENT, holiday });
            const all = [words.label, words.brief, words.ariaLabel, words.tooltip, teamCanDoOptionDescription(mode, { lineMinor, currency, agentLimitMinor: AGENT })].join(" ");
            const at = `${mode} ${lineMinor} ${currency} ${holiday}`;
            expect(all, at).not.toMatch(PLUMBING);
            expect(all, at).not.toMatch(BRITISH);
            expect(all, at).not.toMatch(/no limit|unlimited|up to/i);
            expect(words.tooltip, at).toMatch(/Change it in Settings › What the team can do\./);
            if (typeof lineMinor === "number" && lineMinor > 0 && (holiday || mode !== "augmented")) expect(words.label, at).toContain(spendAmountWords(lineMinor, currency));
            if (holiday) expect(words.tooltip, at).toMatch(/^On vacation\./);
          }
        }
      }
    }
  });

  it("describes each answer without the claim the old copy made, and states the agents row truthfully", () => {
    const line = { lineMinor: 25_000, currency: "GBP", agentLimitMinor: AGENT };
    // Nothing checks whether a recipient is new: the Assisted words never promise it (copy fix, 2026-11-07).
    for (const mode of BUSINESS_MODES) expect(teamCanDoOptionDescription(mode, line)).not.toMatch(/new people|new recipient/i);
    expect(teamCanDoOptionDescription("assisted", line)).toBe("The team does routine work on its own. It asks you before spending over £250, before anything it can't undo and before any contract. It emails and posts for the project on its own.");
    expect(teamCanDoOptionDescription("automated", { ...line, lineMinor: 0 })).toMatch(/^The team works without asking.*Every spend still asks you, and putting changes live/);
    expect(TEAM_CAN_DO_AGENTS_STATEMENT).toMatch(/^The team suggests it in the Inbox and you decide\./);
    expect(TEAM_CAN_DO_ALWAYS_YOURS).toMatch(/Nothing on this page changes that\.$/);
    expect(agentsWithOwnSettingLine(0)).toBeNull();
    expect(agentsWithOwnSettingLine(1)).toBe("1 agent has its own setting for how much it does before asking.");
    expect(agentsWithOwnSettingLine(2)).toBe("2 agents have their own setting for how much they do before asking.");
  });
});
