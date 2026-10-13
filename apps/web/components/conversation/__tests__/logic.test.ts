import { describe, expect, it } from "vitest";
import { RETRY_REPLY_ID, bubbleNeedsMarkdown, deskFailureOf, deskMessagesOf, deskPersonaOf, failureQuickReplies, failureReply, openFailureLine, roleBesideName, samePersonaWords, sayOf, voiceAck, withPlanId, withSent, withoutChoices, type ConversationView } from "../logic";
import { agentOfAskItem, askPaletteItems, askQuestion, generatePaletteItems, paletteAgents } from "../palette";

const persona = (over: Partial<ConversationView["persona"]> = {}): ConversationView["persona"] =>
  ({
    id: "a1",
    name: "Chief of Staff",
    role: "Chief of Staff",
    avatarSeed: "cos",
    layer: "assistant",
    colourToken: null,
    status: "healthy",
    presence: "working",
    presenceLabel: "In a session · Weekly debrief",
    currentTask: { id: "t1", title: "Weekly debrief", status: "running", phase: null, progress: 0.4, eta: null },
    voice: { greeting: "Here.", thinking: ["Pulling up what's open…"], ack: ["Noted. Changing course in this step.", "Understood."] },
    thinkingLine: "Pulling up what's open…",
    nudges: [],
    isAgent: true,
    ...over,
  }) as ConversationView["persona"];

const msg = (id: string, author: "founder" | "agent", text: string) => ({ id, threadId: "th", author, bubbles: [text], at: new Date("2026-10-09T14:02:00Z"), reaction: "none" as const, quickReplies: [], chosenQuickReplyId: null, handOff: null, planId: null, state: "seen" as const });

describe("persona words", () => {
  it("never repeats the name as the role (the 'Chief of Staff Chief of Staff' bug)", () => {
    expect(samePersonaWords("Chief of Staff", " chief  of staff ")).toBe(true);
    expect(roleBesideName("Chief of Staff", "Chief of Staff")).toBeNull();
    expect(roleBesideName("Juno", "Head of Retail Partnerships")).toBe("Head of Retail Partnerships");
    expect(roleBesideName("Juno", "")).toBeNull();
  });

  it("maps the server persona to the desk: Now card from the current task, the fallback colour, no repeated role", () => {
    const p = deskPersonaOf(persona(), "dept-5");
    expect(p).toMatchObject({ name: "Chief of Staff", role: "", dept: "dept-5", doingNow: "Weekly debrief", progress: 0.4, presence: "working" });
    expect(deskPersonaOf(persona({ colourToken: "dept-3", name: "Juno", role: "Head of Retail Partnerships" })).dept).toBe("dept-3");
  });
});

describe("the cached view", () => {
  const view = { thread: null, messages: [msg("m1", "agent", "Hello.")], quickReplies: [] } as unknown as ConversationView;

  it("appends a send's messages once and takes its quick replies (no refetch)", () => {
    const sent = { thread: { id: "th" }, messages: [msg("m2", "founder", "Why?"), msg("m3", "agent", "Because.")], quickReplies: [{ id: "thanks", label: "Thanks", say: "Thanks.", kind: "acknowledge", option_id: null, recommended: false }] } as unknown as Parameters<typeof withSent>[1];
    const next = withSent(view, sent);
    expect(next.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(withSent(next, sent).messages).toHaveLength(3);
    expect(next.quickReplies.map((q) => q.id)).toEqual(["thanks"]);
  });

  it("keeps an optimistic bubble's id once the server has the message, and marks a staged plan", () => {
    const aliased = deskMessagesOf({ messages: [msg("server-1", "founder", "Why?")] } as unknown as ConversationView, new Map([["server-1", "local-1"]]));
    expect(aliased[0]!.id).toBe("local-1");
    expect(withPlanId(view, "m1", "plan-9").messages[0]!.planId).toBe("plan-9");
  });
});

describe("the agent's own words", () => {
  it("acknowledges with the first sentence of a voice line, the same one for the same seed, with no model call", () => {
    const voice = { ack: ["Noted. Changing course in this step.", "Understood."] };
    const a = voiceAck(voice, "task-1:x");
    expect(["Noted.", "Understood."]).toContain(a);
    expect(voiceAck(voice, "task-1:x")).toBe(a);
    expect(voiceAck({ ack: [] }, "s")).toBe("Noted.");
  });

  it("uses Markdown only for bubbles that need it; a quick reply says its words", () => {
    expect(bubbleNeedsMarkdown("Deposit of 50% leaves this week.")).toBe(false);
    expect(bubbleNeedsMarkdown("It's **£18,600** today.")).toBe(true);
    expect(bubbleNeedsMarkdown("- one\n- two")).toBe(true);
    expect(sayOf({ label: "Why that one?", say: "Why that option?" })).toBe("Why that option?");
    expect(sayOf({ label: "Thanks" })).toBe("Thanks");
  });
});

describe("the command palette's Ask and Generate rows", () => {
  const departments = [
    { id: "d1", name: "Retail Partnerships", slug: "retail", colourToken: "dept-3", moduleKeys: ["distribution"], lead: { id: "juno", name: "Juno", role: "Head of Retail Partnerships", avatarSeed: "j" }, squad: [{ id: "juno", name: "Juno", role: "Head of Retail Partnerships", avatarSeed: "j" }, { id: "pike", name: "Pike", role: "Wholesale analyst", avatarSeed: null }], tabs: [{ slug: "formation", position: 0 }] },
    { id: "d2", name: "Development", slug: "development", colourToken: "dept-2", moduleKeys: ["development"], lead: { id: "eng", name: "Engineering Lead", role: "Head of Engineering", avatarSeed: "e" }, squad: [], tabs: [{ slug: "plan", position: 1 }] },
    { id: "d3", name: "Hidden", slug: "hidden", colourToken: "dept-4", moduleKeys: [], hidden: true, lead: { id: "h", name: "Hidden lead", role: null, avatarSeed: null }, squad: [], tabs: [] },
  ];
  const agents = paletteAgents(departments);

  it("leads with the department leads, and with the agents the query names", () => {
    expect(agents.map((a) => a.id)).toEqual(["juno", "eng", "pike"]);
    expect(askPaletteItems(agents, "", () => null).map((i) => i.label)).toEqual(["Ask Juno", "Ask Engineering Lead"]);
    const named = askPaletteItems(agents, "pike how are the wholesale numbers?", () => null);
    expect(named.map((i) => i.label)).toEqual(["Ask Pike"]);
    expect(named[0]).toMatchObject({ kind: "ask", description: "Wholesale analyst · Retail Partnerships" });
    expect(agentOfAskItem(named[0]!, agents)?.id).toBe("pike");
  });

  it("carries the question without the words that only picked the agent", () => {
    expect(askQuestion("ask juno why is cash down?", agents[0]!)).toBe("Why is cash down?");
    expect(askQuestion("engineer what is blocking you?", agents[1]!)).toBe("What is blocking you?");
    expect(askQuestion("juno", agents[0]!)).toBe("");
    // A question typed without its mark gets one; a statement stays as typed.
    expect(askQuestion("ask juno why is cash down", agents[0]!)).toBe("Why is cash down?");
    expect(askQuestion("juno chase the Boots invoice", agents[0]!)).toBe("Chase the Boots invoice");
  });

  it("offers Generate rows only where the surface exists", () => {
    const rows = generatePaletteItems("b1", departments);
    expect(rows.map((r) => r.id)).toEqual(["generate:logos", "generate:task-graph", "generate:channels"]);
    expect(rows.every((r) => r.kind === "generate" && r.href)).toBe(true);
    expect(generatePaletteItems("b1", []).map((r) => r.id)).toEqual(["generate:logos"]);
  });

  it("names the department as the founder named it, never a hard-coded 'Distribution › Board' (AC-11.13.1)", () => {
    const rows = generatePaletteItems("b1", departments);
    expect(rows.find((r) => r.id === "generate:channels")?.description).toBe("Scores every channel for this business · Retail Partnerships › Board");
    expect(rows.find((r) => r.id === "generate:task-graph")?.description).toMatch(/· Development › Plan$/);
    const renamed = departments.map((d) => (d.id === "d2" ? { ...d, name: "Formulation Lab", tabs: [{ slug: "plan", position: 1, title: "Roadmap plan" }] } : d));
    expect(generatePaletteItems("b1", renamed).find((r) => r.id === "generate:task-graph")?.description).toMatch(/· Formulation Lab › Roadmap plan$/);
  });
});

describe("when a send fails (adversarial: api down, model error, limits, stale chips)", () => {
  const trpcError = (code: string, message: string) => Object.assign(new Error(message), { data: { code } });

  it("classifies the failure from the tRPC error", () => {
    expect(deskFailureOf(new TypeError("Failed to fetch")).kind).toBe("offline");
    expect(deskFailureOf(Object.assign(new Error("fetch failed"), { name: "TRPCClientError" })).kind).toBe("offline");
    expect(deskFailureOf(trpcError("TOO_MANY_REQUESTS", "Conversation limit reached. Try again in 2 minutes.")).kind).toBe("limited");
    expect(deskFailureOf(trpcError("BAD_GATEWAY", "The model did not answer")).kind).toBe("failed");
    expect(deskFailureOf(trpcError("INTERNAL_SERVER_ERROR", "boom")).kind).toBe("failed");
    expect(deskFailureOf(trpcError("BAD_REQUEST", "That quick reply is no longer available")).kind).toBe("stale");
    expect(deskFailureOf(trpcError("FORBIDDEN", "You do not have write access to inbox")).kind).toBe("refused");
  });

  it("answers in the agent's own voice, keeps the founder's words, and never claims to be human", () => {
    for (const [kind, message] of [["offline", ""], ["limited", "Conversation limit reached. Try again in 2 minutes."], ["failed", ""], ["stale", "This one is already decided, so there is nothing left to choose"], ["refused", "You do not have write access to inbox"]] as const) {
      const r = failureReply(kind, message);
      expect(r.bubbles.length).toBeGreaterThanOrEqual(1);
      expect(r.bubbles.length).toBeLessThanOrEqual(3);
      const text = r.bubbles.join(" ");
      expect(text).not.toMatch(/\b(I am|I'm) (a )?(human|person)\b|Failed to fetch|TRPC|undefined/i);
      expect(r.retry).toBe(kind === "offline" || kind === "limited" || kind === "failed");
      if (r.retry) expect(text).toMatch(/kept here/);
    }
    expect(failureReply("limited", "Conversation limit reached. Try again in 2 minutes.").bubbles[1]).toBe("Try again in 2 minutes; your message is kept here.");
    expect(failureReply("stale", "This one is already decided, so there is nothing left to choose").bubbles).toEqual(["This one is already decided, so there is nothing left to choose.", "Here's what's open now."]);
    expect(openFailureLine(new TypeError("Failed to fetch"))).toBe("The conversation couldn't be opened: the connection dropped.");
  });

  it("offers Try again first, then what was on offer before (never the reply that failed, never a stale Go with), 2–4 in all", () => {
    const before = [
      { id: "go_with", label: "Go with: Place the order", kind: "choose_option" as const, option_id: "order", recommended: true },
      { id: "why_that_one", label: "Why that one?", kind: "ask" as const },
      { id: "whats_the_risk", label: "What's the risk?", kind: "ask" as const },
      { id: "something_else", label: "Something else…", kind: "write" as const },
    ];
    const retry = failureQuickReplies(true, before, "why_that_one");
    expect(retry.map((r) => r.id)).toEqual([RETRY_REPLY_ID, "go_with", "whats_the_risk"]);
    expect(retry.filter((r) => r.recommended).map((r) => r.id)).toEqual([RETRY_REPLY_ID]);
    expect(failureQuickReplies(true, before, null, true).map((r) => r.id)).toEqual([RETRY_REPLY_ID, "why_that_one", "whats_the_risk"]);
    expect(failureQuickReplies(false, before, "go_with", true).map((r) => r.id)).toEqual(["why_that_one", "whats_the_risk"]);
    expect(failureQuickReplies(true, [...before, ...before.map((r) => ({ ...r, id: `${r.id}2` }))], null).length).toBe(4);
  });

  it("drops Go with from every message once the item is decided", () => {
    const msgs = [{ id: "m1", quickReplies: [{ id: "go_with", label: "Go with: A", kind: "choose_option" as const }, { id: "thanks", label: "Thanks" }] }, { id: "m2" }];
    expect(withoutChoices(msgs, false)).toEqual(msgs);
    expect(withoutChoices(msgs, true)[0]!.quickReplies!.map((q) => q.id)).toEqual(["thanks"]);
    expect(withoutChoices(msgs, true)[1]).toBe(msgs[1]);
  });
});
