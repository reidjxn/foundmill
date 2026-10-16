// @vitest-environment happy-dom
/**
 * A reply streamed bubble by bubble (audit MB-1): each bubble shows the moment the API yields it, the typing line stays
 * until the reply is stored, and the stored reply takes the streamed bubbles' place (shown once, not twice). A reply that
 * breaks off part-way withdraws what it showed and ends in "Not sent" with "Try again" (the server stored none of it).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, TooltipProvider } from "@foundmill/dugout";
import { isStreamingOperation } from "@/lib/trpc";
import type { ReplyStreamEvent } from "../logic";

/** A stream the test pushes events into, like `agent.conversation.sendStream` over httpBatchStreamLink. */
function pushStream<T>() {
  const queue: T[] = [];
  let wake: (() => void) | null = null;
  let ended: { error?: unknown } | null = null;
  const stream: AsyncIterable<T> = {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        while (queue.length) yield queue.shift()!;
        if (ended) {
          if (ended.error) throw ended.error;
          return;
        }
        await new Promise<void>((r) => (wake = r));
      }
    },
  };
  const poke = () => {
    wake?.();
    wake = null;
  };
  return { stream, push: (e: T) => (queue.push(e), poke()), end: (error?: unknown) => ((ended = { error }), poke()) };
}

const api = vi.hoisted(() => ({ sendStream: vi.fn() }));

const AGENT = "4c76f0d6-2afd-4bdd-adbf-2a82479eadf3";
const at = new Date("2026-10-16T14:02:00Z");
const persona = {
  id: AGENT,
  name: "Juno",
  role: "Head of Retail",
  avatarSeed: "juno",
  layer: "worker",
  colourToken: null,
  status: "healthy",
  presence: "available",
  presenceLabel: "Available",
  currentTask: null,
  voice: { greeting: "Here.", thinking: ["Checking the plan…"], ack: ["Noted."] },
  thinkingLine: "Checking the plan…",
  nudges: [],
  isAgent: true,
};
const starters = [
  { id: "what_are_you_on", label: "What are you working on?", say: "What are you working on?", kind: "ask", option_id: null, recommended: false },
  { id: "whats_next", label: "What's next?", say: "What's next?", kind: "ask", option_id: null, recommended: false },
];
const view = { subject: { kind: "agent", id: AGENT, title: "Juno", itemType: null, answered: false, options: [] }, thread: null, messages: [], persona, starters, quickReplies: starters };

vi.mock("@/lib/trpc-react", () => ({
  useTRPCClient: () => ({ agent: { conversation: { sendStream: { mutate: api.sendStream }, inboxReplyStream: { mutate: vi.fn() } } } }),
  useTRPC: () => ({
    agent: {
      conversation: {
        get: { queryOptions: (input: unknown, opts: Record<string, unknown>) => ({ queryKey: [["agent", "conversation", "get"], { input, type: "query" }], queryFn: () => view, ...opts }), queryKey: (input: unknown) => [["agent", "conversation", "get"], { input, type: "query" }] },
        handOff: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: vi.fn(), ...opts }) },
      },
    },
    dev: { tasks: { pause: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: vi.fn(), ...opts }) } } },
    plan: { confirm: { mutationOptions: (opts: Record<string, unknown> = {}) => ({ mutationFn: vi.fn(), ...opts }) } },
  }),
}));
vi.mock("@/components/shell/business-context", () => ({
  useBusiness: () => ({ businessId: "b1", data: { business: { currency: "USD" } }, access: { canChange: true } }),
  useBusinessCurrency: () => "USD",
}));

import { AgentConversation } from "../AgentConversation";

function renderDesk() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ToastProvider renderViewport={false}>
          <AgentConversation subject={{ kind: "agent", id: AGENT }} hotkeys={false} />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

const sent = (bubbles: string[]) => ({
  thread: { id: "th1" },
  messages: [
    { id: "m-founder", threadId: "th1", author: "founder", bubbles: ["What's next?"], at, reaction: "none", quickReplies: [], chosenQuickReplyId: "whats_next", handOff: null, planId: null, planStatus: null, clientMessageId: "c1", state: "seen" },
    { id: "m-agent", threadId: "th1", author: "agent", bubbles, at, reaction: "noted", quickReplies: starters, chosenQuickReplyId: null, handOff: null, planId: null, planStatus: null, clientMessageId: null, state: "seen" },
  ],
  quickReplies: starters,
  decision: null,
  handOff: null,
});

const agentBubbles = () => screen.queryAllByTestId("agent-bubble").map((b) => b.textContent?.replace(/^Juno: /, ""));

async function pressWhatsNext() {
  await screen.findByTestId("agent-desk");
  fireEvent.click(await screen.findByRole("button", { name: /What's next\?/ }));
}

describe("a reply streamed bubble by bubble (audit MB-1)", () => {
  beforeEach(() => api.sendStream.mockReset());

  it("goes over the streaming link", () => {
    expect(isStreamingOperation({ path: "agent.conversation.sendStream" })).toBe(true);
    expect(isStreamingOperation({ path: "agent.conversation.inboxReplyStream" })).toBe(true);
    expect(isStreamingOperation({ path: "idea.askStream" })).toBe(true);
    expect(isStreamingOperation({ path: "agent.conversation.send" })).toBe(false);
  });

  it("shows each bubble as it arrives while the agent is still typing, then the stored reply in their place, once", async () => {
    const s = pushStream<ReplyStreamEvent<ReturnType<typeof sent>>>();
    api.sendStream.mockResolvedValue(s.stream);
    renderDesk();
    await pressWhatsNext();
    expect(api.sendStream).toHaveBeenCalledWith(expect.objectContaining({ businessId: "b1", subject: { kind: "agent", id: AGENT }, quickReplyId: "whats_next" }));

    await act(async () => s.push({ type: "bubble", index: 0, text: "Next up is the carton proof." }));
    await waitFor(() => expect(agentBubbles()).toContain("Next up is the carton proof."));
    // Still writing: the typing line stays and the quick replies wait.
    expect(screen.getByTestId("desk-replies-waiting")).toBeTruthy();

    await act(async () => s.push({ type: "bubble", index: 1, text: "Then the retail deck." }));
    await waitFor(() => expect(agentBubbles()).toContain("Then the retail deck."));

    await act(async () => {
      s.push({ type: "done", result: sent(["Next up is the carton proof.", "Then the retail deck."]) });
      s.end();
    });
    await waitFor(() => expect(screen.queryByTestId("desk-replies-waiting")).toBeNull());
    expect(agentBubbles().filter((b) => b === "Next up is the carton proof.")).toHaveLength(1);
    expect(agentBubbles().filter((b) => b === "Then the retail deck.")).toHaveLength(1);
    expect(screen.queryByText("Not sent")).toBeNull();
  });

  it("a reply that breaks off after its first bubble withdraws it and ends in Not sent, with Try again", async () => {
    const s = pushStream<ReplyStreamEvent<ReturnType<typeof sent>>>();
    api.sendStream.mockResolvedValue(s.stream);
    renderDesk();
    await pressWhatsNext();
    await act(async () => s.push({ type: "bubble", index: 0, text: "Half of a thought." }));
    await waitFor(() => expect(agentBubbles()).toContain("Half of a thought."));

    await act(async () => s.end(Object.assign(new Error("The model failed"), { data: { code: "INTERNAL_SERVER_ERROR" } })));
    await waitFor(() => expect(screen.getByText("Not sent")).toBeTruthy());
    expect(agentBubbles()).not.toContain("Half of a thought.");
    expect(agentBubbles().join(" ")).toContain("I couldn't put a reply together just then.");
    expect(document.querySelector('[data-quick-reply="local-retry"]')).toBeTruthy();
  });

  it("a reset withdraws the bubbles shown so far (the reply is being written again)", async () => {
    const s = pushStream<ReplyStreamEvent<ReturnType<typeof sent>>>();
    api.sendStream.mockResolvedValue(s.stream);
    renderDesk();
    await pressWhatsNext();
    await act(async () => s.push({ type: "bubble", index: 0, text: "A first try." }));
    await waitFor(() => expect(agentBubbles()).toContain("A first try."));
    await act(async () => s.push({ type: "reset" }));
    await waitFor(() => expect(agentBubbles()).not.toContain("A first try."));
  });
});
