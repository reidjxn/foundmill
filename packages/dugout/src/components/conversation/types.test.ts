import { describe, expect, it } from "vitest";
import {
  JUNO,
  JUNO_HANDOFF,
  JUNO_MESSAGES,
  JUNO_WAITING,
  DECISION_STARTERS,
  deskAt,
} from "./fixtures";
import { receiptState, receiptWords } from "./ReadReceipt";
import {
  currentQuickReplies,
  founderTurn,
  groupMessages,
  lowerLeadingVerb,
  presenceWords,
  reactionsByFounderMessage,
  readTimesByFounderMessage,
  settleQuickReplies,
  thinkingPhraseFor,
  toneClass,
  typingSentence,
  type QuickReplyItem,
} from "./types";

describe("settleQuickReplies", () => {
  it("sets the write chip aside, keeps order, and picks the recommended reply as likeliest", () => {
    const s = settleQuickReplies(DECISION_STARTERS);
    expect(s.choices.map((c) => c.id)).toEqual(["go_with", "why_that_one", "whats_the_risk"]);
    expect(s.write?.id).toBe("something_else");
    expect(s.likeliest).toBe("go_with");
  });
  it("pads to two from the fallbacks, de-duplicates by label, caps at four", () => {
    expect(
      settleQuickReplies([{ id: "a", label: "Tell me more" }]).choices.map((c) => c.label),
    ).toEqual(["Tell me more", "Thanks, carry on"]);
    expect(
      settleQuickReplies([
        { id: "a", label: "Why?" },
        { id: "b", label: "why?" },
      ]).choices,
    ).toHaveLength(2);
    const many = Array.from({ length: 7 }, (_, i): QuickReplyItem => ({
      id: `r${i}`,
      label: `R${i}`,
    }));
    expect(settleQuickReplies(many).choices).toHaveLength(4);
    expect(settleQuickReplies([]).choices).toHaveLength(0);
    expect(settleQuickReplies(undefined).likeliest).toBeNull();
  });
  it("defaults the likeliest to the first when none is recommended", () => {
    expect(
      settleQuickReplies([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]).likeliest,
    ).toBe("a");
  });
});

describe("presence and typing words", () => {
  it("prefers typing, then presence", () => {
    expect(presenceWords(JUNO, true)).toEqual({ state: "live", words: "Live · typing" });
    expect(presenceWords(JUNO, false)).toEqual({ state: "working", words: "In a session" });
    expect(
      presenceWords({ presence: "working", presenceLabel: "In a session · Carton proof" }, false)
        .words,
    ).toBe("In a session · Carton proof");
    expect(presenceWords({ presence: "away" }, false).words).toBe("Away");
    expect(presenceWords({ presence: "down", expectedBack: "2:30 PM" }, false).words).toBe(
      "Down · back 2:30 PM",
    );
    expect(presenceWords({ presence: "available" }, false).words).toBe("Available");
  });
  it("always names what the agent is looking at", () => {
    expect(thinkingPhraseFor(JUNO)).toBe("reading Boots UK's supplier terms");
    expect(thinkingPhraseFor({ voice: null, doingNow: "Boots UK trial model" })).toBe(
      "checking Boots UK trial model",
    );
    expect(thinkingPhraseFor({ voice: null, doingNow: null })).toBe(
      "reading back through the thread",
    );
    expect(typingSentence("Juno", "Reading Boots UK's terms")).toBe(
      "Juno is typing · reading Boots UK's terms",
    );
    expect(lowerLeadingVerb("Boots UK's terms")).toBe("Boots UK's terms");
  });
});

describe("thread helpers", () => {
  it("groups by author and carries the agent's reaction to the founder bubble", () => {
    expect(groupMessages(JUNO_HANDOFF).map((g) => g.author)).toEqual([
      "founder",
      "agent",
      "founder",
      "agent",
    ]);
    const r = reactionsByFounderMessage(JUNO_HANDOFF);
    expect(r.get("m1")).toBe("noted");
    expect(r.get("m3")).toBe("pleased");
  });
  it("reads a founder message when the agent answers it", () => {
    const t = readTimesByFounderMessage(JUNO_WAITING);
    expect(t.get("m1")).toEqual(deskAt(1));
    expect(t.has("m3")).toBe(false);
  });
  it("knows whose turn it is and which replies to offer", () => {
    expect(founderTurn(JUNO_MESSAGES)).toBe(true);
    expect(founderTurn(JUNO_WAITING)).toBe(false);
    expect(founderTurn([])).toBe(true);
    expect(currentQuickReplies(JUNO_MESSAGES, DECISION_STARTERS)[0]!.id).toBe("ask_for_45");
    expect(currentQuickReplies([], DECISION_STARTERS)).toBe(DECISION_STARTERS);
  });
  it("never colours with a generic violet", () => {
    expect(toneClass(undefined)).toBe("tone-kit-lift");
    expect(toneClass("kit")).toBe("tone-kit-lift");
    expect(toneClass("dept-3")).toBe("tone-dept-3");
  });
});

describe("read receipts", () => {
  it("says sending, seen, read with a time, and not sent", () => {
    expect(receiptWords(receiptState("sending", null))).toBe("Sending…");
    expect(receiptWords(receiptState("seen", null))).toBe("Seen");
    expect(receiptWords(receiptState("seen", deskAt(1)), deskAt(1))).toBe("Read 2:02 PM");
    expect(receiptWords(receiptState("failed", deskAt(1)))).toBe("Not sent");
    expect(receiptState(undefined, undefined)).toBe("seen");
  });
});
