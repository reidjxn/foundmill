/**
 * One vocabulary in the shell (WP-02 T8): what a first-timer reads with Builder view off names no cycle, no
 * orchestrator, no Inbox as a place to go and no "business" before the first sale. Builder view keeps the engine's words.
 */
import { DEFAULT_FIRST_WEEK_ITEMS, NEEDS_YOU_WORDS, processingStatusText } from "@foundmill/dugout";
import { continueRunEndedMessage } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { EMPTY_TEXT, REFRESH_HINT } from "../../components/inbox/InboxScreen";
import { AUTOPILOT_CONTINUE_NOTE } from "../../components/settings/AutopilotSection";
import { ORCHESTRATOR_DOWN_CAVEAT, describePause, lastCycleCostLine } from "../../components/shell/BusinessShell";
import { EXAMPLE_READ_ONLY_REASON, SAMPLE_BUSINESS_LABEL } from "../access";
import { businessScreenTitle } from "../page-titles";

const ENGINE = /\bcycles?\b|orchestrator|\bInbox\b(?! tab)|Switch business|Sample business/;

describe("shell words with Builder view off", () => {
  const strings: Record<string, string> = {
    idle: processingStatusText([], false),
    working: processingStatusText([], true, 3),
    inboxAll: EMPTY_TEXT.all,
    refresh: REFRESH_HINT,
    caveat: ORCHESTRATOR_DOWN_CAVEAT,
    cost: lastCycleCostLine({ amountMinor: 52, currency: "USD" }) ?? "",
    paused: describePause({ paused: true, pausedTasks: 0, reason: undefined, runEnded: true }).description,
    nothing: describePause({ paused: false, pausedTasks: 0, reason: undefined }).description,
    autopilot: AUTOPILOT_CONTINUE_NOTE,
    seeAll: NEEDS_YOU_WORDS.seeAll,
    checklist: DEFAULT_FIRST_WEEK_ITEMS.map((i) => i.label).join(" · "),
    example: EXAMPLE_READ_ONLY_REASON,
    sample: SAMPLE_BUSINESS_LABEL,
  };
  for (const [name, text] of Object.entries(strings)) {
    it(`${name}: ${text}`, () => expect(text).not.toMatch(ENGINE));
  }

  it("Needs you is the title of the Inbox's respond tab", () => {
    const B = "b1e5e5e5-0000-4000-8000-000000000001";
    expect(businessScreenTitle(`/b/${B}/inbox`, B, [], null, "respond")).toBe("Needs you");
    expect(businessScreenTitle(`/b/${B}/inbox`, B, [], null, null)).toBe("Inbox");
  });

  it("Builder view keeps the engine's word", () => {
    expect(processingStatusText([], false, null, true)).toBe("No cycle running");
  });

  it("the stopped Autopilot notice sends the founder to Needs you", () => {
    expect(continueRunEndedMessage("hard_stop")?.description).toBe("Something needs you before the team can carry on. Open Needs you.");
  });
});
