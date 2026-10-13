import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentDesk, type AgentDeskProps } from "./AgentDesk";
import {
  CERTIFICATION,
  CERTIFICATION_MESSAGES,
  DECISION_STARTERS,
  JUNO,
  JUNO_HANDOFF,
  JUNO_MESSAGES,
  JUNO_WAITING,
  RESEARCH_AGENT,
  RESEARCH_MESSAGES,
  deskAt,
} from "./fixtures";

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
}

function desk(over: Partial<AgentDeskProps> = {}) {
  const props: AgentDeskProps = {
    persona: JUNO,
    messages: JUNO_MESSAGES,
    starters: DECISION_STARTERS,
    label: "Conversation with Juno",
    onQuickReply: vi.fn(),
    onSend: vi.fn(),
    ...over,
  };
  return { props, ...render(<AgentDesk {...props} />) };
}

const replyButtons = () =>
  screen
    .queryAllByRole("button")
    .filter(
      (b) => b.hasAttribute("data-quick-reply") && b.getAttribute("data-quick-reply") !== "write",
    );

afterEach(() => vi.restoreAllMocks());

describe("AgentDesk", () => {
  it("shows the agent at their desk: portrait, name, role, AI marker, state and the Now card", () => {
    desk();
    const presence = screen.getByTestId("desk-presence");
    expect(within(presence).getByText("Juno", { selector: "span" })).toBeTruthy();
    expect(within(presence).getByText("Head of Retail Partnerships")).toBeTruthy();
    expect(within(presence).getByText("AI agent")).toBeTruthy();
    expect(within(presence).getByRole("img", { name: /Juno, healthy, working/ })).toBeTruthy();
    expect(screen.getByTestId("desk-state").textContent).toBe("In a session");
    const now = screen.getByTestId("desk-now");
    expect(now.textContent).toContain("Boots UK trial model, v3");
    expect(within(now).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("62");
  });

  it("draws founder and agent bubbles, the agent's reaction on the founder bubble, and the read time", () => {
    desk();
    expect(screen.getAllByTestId("founder-bubble")).toHaveLength(1);
    expect(screen.getAllByTestId("agent-bubble")).toHaveLength(2);
    const reaction = within(screen.getByTestId("founder-bubble")).getByRole("img", {
      name: "Juno reacted: noted",
    });
    expect(reaction.getAttribute("data-reaction")).toBe("noted");
    expect(screen.getByTestId("read-receipt").textContent).toBe("Read 2:02 PM");
    expect(screen.getByTestId("read-receipt").getAttribute("data-state")).toBe("read");
  });

  it("offers the latest agent message's replies on the founder's turn, and 1–4 send them", () => {
    const { props } = desk();
    expect(replyButtons().map((b) => b.textContent)).toEqual([
      "1Yes, ask for 45 days",
      "2Show me December",
      "3What does Boots risk?",
    ]);
    fireEvent.keyDown(document, { key: "3", code: "Digit3" });
    expect(props.onQuickReply).toHaveBeenCalledWith(JUNO_MESSAGES[1]!.quickReplies![2]);
  });

  it("takes Alt+1–4 in the Inbox", () => {
    const { props } = desk({ keyModifier: "alt" });
    fireEvent.keyDown(document, { key: "1", code: "Digit1" });
    expect(props.onQuickReply).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "¡", code: "Digit1", altKey: true });
    expect(props.onQuickReply).toHaveBeenCalledWith(JUNO_MESSAGES[1]!.quickReplies![0]);
  });

  it("while the reply is in flight: the typing line names what the agent is reading, and the replies wait", () => {
    const { props } = desk({ messages: JUNO_WAITING, replying: true });
    expect(screen.getByTestId("typing-line").textContent).toBe(
      "Juno is typing · reading Boots UK's supplier terms",
    );
    expect(screen.getByTestId("desk-state").textContent).toBe("Live · typing");
    expect(replyButtons()).toHaveLength(0);
    fireEvent.keyDown(document, { key: "1", code: "Digit1" });
    expect(props.onQuickReply).not.toHaveBeenCalled();
    // The founder's newest message has been seen, not yet read.
    expect(screen.getByTestId("read-receipt").textContent).toBe("Seen");
    expect(screen.getByTestId("desk-thread").getAttribute("aria-busy")).toBe("true");
  });

  it("uses a given thinking phrase, else the current task", () => {
    const { rerender, props } = desk({
      messages: JUNO_WAITING,
      replying: true,
      thinkingPhrase: "Rerunning the December cash line",
    });
    expect(screen.getByTestId("typing-line").textContent).toBe(
      "Juno is typing · rerunning the December cash line",
    );
    rerender(
      <AgentDesk {...props} thinkingPhrase={undefined} persona={{ ...JUNO, voice: null }} />,
    );
    expect(screen.getByTestId("typing-line").textContent).toBe(
      "Juno is typing · checking Boots UK trial model, v3",
    );
  });

  it("opens an empty thread with the agent's greeting and the starters", () => {
    desk({ messages: [] });
    expect(screen.getByTestId("agent-bubble").textContent).toContain(
      "I've modeled the Boots UK trial",
    );
    expect(replyButtons().map((b) => b.textContent)).toEqual([
      "1Go with: Approve the trial",
      "2Why that one?",
      "3What's the risk?",
    ]);
    expect(screen.getByRole("button", { name: "Write" })).toBeTruthy();
  });

  it("never shows fewer than two replies on the founder's turn", () => {
    desk({
      messages: [
        { ...JUNO_MESSAGES[1]!, quickReplies: [{ id: "only", label: "Show me December" }] },
      ],
    });
    expect(replyButtons()).toHaveLength(2);
  });

  it("Write reveals the field and sends typed text", async () => {
    const user = userEvent.setup();
    const { props } = desk();
    await user.click(screen.getByRole("button", { name: "Write" }));
    await user.type(
      screen.getByRole("textbox", { name: "Reply to Juno" }),
      "Can Boots take 30 stores instead?{Enter}",
    );
    expect(props.onSend).toHaveBeenCalledWith("Can Boots take 30 stores instead?");
  });

  it("read-only: no replies, no field, and the reason instead", () => {
    desk({ disabled: true, disabledNote: "Only owners and members can reply to Juno." });
    expect(replyButtons()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Write|Something else/ })).toBeNull();
    expect(screen.getByText("Only owners and members can reply to Juno.")).toBeTruthy();
  });

  it('shows a hand-off; its own "Review the plan" reply is the one way to review it', () => {
    desk({ messages: JUNO_HANDOFF, onHandOff: vi.fn() });
    const strip = screen.getByTestId("desk-handoff");
    expect(strip.textContent).toContain("Nothing runs until you confirm the plan.");
    expect(within(strip).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Review the plan/ })).toHaveLength(1);
  });

  it("lets the founder review a hand-off whose replies do not offer it; nothing runs from here", async () => {
    const user = userEvent.setup();
    const onHandOff = vi.fn();
    const last = {
      ...JUNO_HANDOFF[3]!,
      quickReplies: [
        { id: "thanks", label: "Thanks" },
        { id: "whats_next", label: "What happens after?" },
      ],
    };
    desk({ messages: [...JUNO_HANDOFF.slice(0, 3), last], onHandOff });
    const strip = screen.getByTestId("desk-handoff");
    await user.click(within(strip).getByRole("button", { name: "Review the plan" }));
    expect(onHandOff).toHaveBeenCalledWith("m4");
  });

  it("a staged plan stays reviewable until it is confirmed (after a reload, from another device)", async () => {
    const user = userEvent.setup();
    const onHandOff = vi.fn();
    const last = {
      ...JUNO_HANDOFF[3]!,
      planId: "plan-1",
      quickReplies: [
        { id: "thanks", label: "Thanks" },
        { id: "whats_next", label: "What happens after?" },
      ],
    };
    const { unmount } = desk({ messages: [...JUNO_HANDOFF.slice(0, 3), last], onHandOff });
    let strip = screen.getByTestId("desk-handoff");
    expect(strip.textContent).toContain("Plan staged. Nothing runs until you confirm it.");
    await user.click(within(strip).getByRole("button", { name: "Review the plan" }));
    expect(onHandOff).toHaveBeenCalledWith("m4");
    unmount();

    desk({ messages: [...JUNO_HANDOFF.slice(0, 3), { ...last, planConfirmed: true }], onHandOff });
    strip = screen.getByTestId("desk-handoff");
    expect(strip.textContent).toContain("Plan confirmed. The team is on it.");
    expect(strip.getAttribute("data-confirmed")).toBe("true");
    expect(within(strip).queryByRole("button")).toBeNull();
  });

  it("never offers the hand-off action when the founder cannot act", () => {
    const last = {
      ...JUNO_HANDOFF[3]!,
      quickReplies: [
        { id: "thanks", label: "Thanks" },
        { id: "whats_next", label: "What happens after?" },
      ],
    };
    desk({ messages: [...JUNO_HANDOFF.slice(0, 3), last], onHandOff: vi.fn(), disabled: true });
    expect(within(screen.getByTestId("desk-handoff")).queryByRole("button")).toBeNull();
  });

  it("marks a message that did not send and offers to try again", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    desk({
      messages: [
        ...JUNO_MESSAGES,
        {
          id: "m3",
          author: "founder",
          bubbles: ["Show me December"],
          at: deskAt(2),
          state: "failed",
        },
      ],
      onRetry,
    });
    expect(screen.getByTestId("read-receipt").textContent).toBe("Not sent");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledWith("m3");
  });

  it("lands a new reply's bubbles 120 ms apart (CSS stagger) and history settled", () => {
    mockReducedMotion(false);
    const { rerender, props } = desk({ messages: JUNO_WAITING, replying: true });
    for (const b of screen.getAllByTestId("agent-bubble"))
      expect(b.className).not.toMatch(/desk-arrive/);
    const reply = {
      id: "m4",
      author: "agent" as const,
      bubbles: ["The 60-day terms.", "Cash dips to £41K in December (Forecast)."],
      at: deskAt(3),
    };
    rerender(<AgentDesk {...props} replying={false} messages={[...JUNO_WAITING, reply]} />);
    const fresh = screen
      .getAllByTestId("agent-bubble")
      .filter((b) => b.className.includes("desk-arrive"));
    expect(fresh).toHaveLength(2);
    expect(fresh.map((b) => b.style.getPropertyValue("--i"))).toEqual(["0", "1"]);
  });

  it("renders a streaming bubble whole under reduced motion", () => {
    mockReducedMotion(true);
    desk({
      messages: [
        ...JUNO_WAITING,
        {
          id: "m4",
          author: "agent",
          bubbles: ["The 60-day terms."],
          at: deskAt(3),
          streaming: true,
        },
      ],
    });
    const stream = screen.getByTestId("streaming-text");
    expect(stream.firstElementChild!.textContent).toBe("The 60-day terms.");
  });

  it("compact: a slim head and the portrait on the last bubble of the agent's group", () => {
    desk({
      variant: "compact",
      persona: CERTIFICATION,
      messages: CERTIFICATION_MESSAGES,
      label: "Conversation with the Certification Specialist",
    });
    expect(screen.getByTestId("desk-presence").getAttribute("data-layout")).toBe("head");
    expect(screen.getByTestId("desk-state").textContent).toBe("Down · back 2:30 PM");
    const rows = screen.getAllByTestId("agent-bubble").map((b) => b.parentElement!);
    expect(rows[0]!.querySelector('[role="img"]')).toBeNull();
    expect(rows[1]!.querySelector('[role="img"]')).not.toBeNull();
  });

  it("sheet: a dialog named for the conversation; Escape in the Write field closes the field, not the sheet", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    desk({
      variant: "sheet",
      persona: RESEARCH_AGENT,
      messages: RESEARCH_MESSAGES,
      label: "Ask the Research agent about Shelfproof",
      onOpenChange,
    });
    const dialog = screen.getByRole("dialog", { name: "Ask the Research agent about Shelfproof" });
    expect(dialog.getAttribute("data-variant")).toBe("sheet");
    await user.click(within(dialog).getByRole("button", { name: "Write" }));
    await user.keyboard("{Escape}");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("AgentDesk: never makes the founder type", () => {
  it("offers generic replies when nothing is on offer (sent as text)", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onQuickReply = vi.fn();
    render(
      <AgentDesk
        persona={JUNO}
        messages={[{ ...JUNO_MESSAGES[1]!, quickReplies: [] }]}
        starters={[]}
        label="Conversation with Juno"
        onQuickReply={onQuickReply}
        onSend={onSend}
      />,
    );
    const buttons = replyButtons();
    expect(buttons.map((b) => b.textContent)).toEqual(["1Tell me more", "2Thanks, carry on"]);
    await user.click(buttons[0]!);
    expect(onSend).toHaveBeenCalledWith("Tell me more");
    expect(onQuickReply).not.toHaveBeenCalled();
  });

  it("opens an empty thread with no starters on two questions of its own", () => {
    render(
      <AgentDesk
        persona={{ ...JUNO, voice: null }}
        messages={[]}
        starters={[]}
        label="Conversation with Juno"
        onQuickReply={vi.fn()}
        onSend={vi.fn()}
      />,
    );
    expect(replyButtons().map((b) => b.textContent)).toEqual([
      "1What are you working on?",
      "2Anything blocking you?",
    ]);
  });

  it("keeps keyboard focus in the conversation when a pressed reply goes away", async () => {
    const user = userEvent.setup();
    const props: AgentDeskProps = {
      persona: JUNO,
      messages: JUNO_MESSAGES,
      label: "Conversation with Juno",
      onQuickReply: vi.fn(),
      onSend: vi.fn(),
    };
    const { rerender } = render(<AgentDesk {...props} />);
    replyButtons()[1]!.focus();
    await user.keyboard("{Enter}");
    rerender(<AgentDesk {...props} messages={JUNO_WAITING} replying />);
    expect(document.activeElement).toBe(screen.getByTestId("desk-thread"));
  });
});

describe("deskPersonaFrom", () => {
  it("maps the API persona onto the desk", async () => {
    const { deskPersonaFrom } = await import("./types");
    const p = deskPersonaFrom(
      {
        id: "a",
        name: "Chief of Staff",
        role: "Chief of Staff",
        avatarSeed: "cos",
        colourToken: null,
        presence: "available",
        presenceLabel: "Available",
        currentTask: { title: "Weekly debrief", progress: 0.4 },
        thinkingLine: "Pulling up what's open…",
      },
      "dept-5",
    );
    expect(p.dept).toBe("dept-5");
    expect(p.doingNow).toBe("Weekly debrief");
    expect(p.progress).toBe(0.4);
    expect(p.thinkingLine).toBe("Pulling up what's open…");
  });
});
