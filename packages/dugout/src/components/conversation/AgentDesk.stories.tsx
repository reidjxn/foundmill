import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { EntityText } from "../data/EntityText";
import { Button } from "../foundation/Button";
import { NORTHWIND_KIT } from "../shell/fixtures";
import { kitStyle } from "../shell/KitBar";
import { AgentDesk, type AgentDeskProps } from "./AgentDesk";
import {
  CERTIFICATION,
  CERTIFICATION_MESSAGES,
  CONCEPT_STARTERS,
  DECISION_STARTERS,
  JUNO,
  JUNO_HANDOFF,
  JUNO_MESSAGES,
  JUNO_WAITING,
  RESEARCH_AGENT,
  RESEARCH_MESSAGES,
  deskAt,
} from "./fixtures";
import type { DeskMessage, QuickReplyItem } from "./types";

const renderBubble = (md: string) => <EntityText>{md}</EntityText>;
const noop = () => undefined;

const meta = {
  title: "Conversation/AgentDesk",
  component: AgentDesk,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Talking to an agent at their desk (DIRECTION #6): presence beside the thread, founder bubbles in brand glass with a read receipt, agent bubbles in the department's tint, the agent's reaction as an icon disc, a typing line that names what the agent is looking at, and 2–4 quick replies whenever it is the founder's turn (numbered 1–4, or Alt+1–4 in the Inbox), plus a ghost Write.",
      },
    },
  },
  args: {
    persona: JUNO,
    messages: JUNO_MESSAGES,
    starters: DECISION_STARTERS,
    label: "Conversation with Juno",
    renderBubble,
    onQuickReply: noop,
    onSend: noop,
  },
  decorators: [
    // Inside a business: the founder's bubbles take its brand (Northwind Skincare).
    (Story) => (
      <div className="max-w-208" style={kitStyle(NORTHWIND_KIT)}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AgentDesk>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The Inbox: Juno's reply has landed and it is the founder's turn. */
export const Inline: Story = {};

/** The reply is in flight: "Juno is typing · reading Boots UK's supplier terms", and the replies wait. */
export const Replying: Story = { args: { messages: JUNO_WAITING, replying: true } };

/** A fresh thread: the agent's own greeting and the deterministic starters (no model call). */
export const Empty: Story = { args: { messages: [] } };

/** In the Inbox, 1–4 belong to the DecisionBar's options, so quick replies take Alt+1–4. */
export const InboxKeys: Story = { name: "Inbox keys (Alt+1–4)", args: { keyModifier: "alt" } };

/** The agent offers to hand work off; nothing runs until the founder reviews and confirms the plan. */
export const HandOff: Story = { args: { messages: JUNO_HANDOFF, onHandOff: noop } };

/** A message that did not reach the server: "Not sent" and Try again. */
export const NotSent: Story = {
  args: {
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
    onRetry: noop,
  },
};

/** Read-only: the founder can read the thread but not reply here. */
export const ReadOnly: Story = {
  args: { disabled: true, disabledNote: "Only owners and members can reply to Juno." },
};

/** Compact: a slim head and the portrait on the last bubble of a group (an agent who is down until 14:30). */
export const Compact: Story = {
  args: {
    variant: "compact",
    persona: CERTIFICATION,
    messages: CERTIFICATION_MESSAGES,
    starters: [],
    label: "Conversation with the Certification Specialist",
  },
  decorators: [
    (Story) => (
      <div className="max-w-112">
        <Story />
      </div>
    ),
  ],
};

/** The Ideation Studio's Ask: the Research agent in a right-side sheet. */
export const Sheet: Story = {
  args: {
    variant: "sheet",
    persona: RESEARCH_AGENT,
    messages: RESEARCH_MESSAGES,
    starters: CONCEPT_STARTERS,
    label: "Ask the Research agent about Shelfproof",
    subject: "About Shelfproof · Stability and patch-test data as a service",
  },
  parameters: { layout: "fullscreen" },
  render: (args) => <SheetDemo {...args} />,
};

function SheetDemo(args: AgentDeskProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-gutter">
      <Button onClick={() => setOpen(true)}>Ask about Shelfproof</Button>
      <AgentDesk {...args} open={open} onOpenChange={setOpen} />
    </div>
  );
}

/** Press a reply (or 1–4, or Write) and Juno answers: the receipt turns to "Read", bubbles arrive 120 ms apart. */
export const Interactive: Story = {
  args: { messages: [] },
  render: (args) => <InteractiveDemo {...args} />,
};

const ANSWERS: Record<
  string,
  { bubbles: string[]; replies: QuickReplyItem[]; reaction?: DeskMessage["reaction"] }
> = {
  go_with: {
    bubbles: [
      "Approved. 2,400 units ship by October 28.",
      "Nothing is paid until Boots UK's first invoice in December.",
    ],
    reaction: "pleased",
    replies: [
      { id: "whats_next", label: "What happens next?", kind: "ask", recommended: true },
      { id: "show_december", label: "Show me December", kind: "ask" },
      { id: "thanks", label: "Thanks, carry on", kind: "acknowledge" },
    ],
  },
  why_that_one: {
    bubbles: [
      "Approve ships 2,400 units by October 28 and nothing is paid now.",
      "Holding a week risks a stock-out in November, just as Ireland opens.",
    ],
    reaction: "noted",
    replies: [
      {
        id: "go_with",
        label: "Go with: Approve the trial",
        kind: "choose_option",
        option_id: "approve",
        recommended: true,
      },
      { id: "whats_the_risk", label: "What's the risk?", kind: "ask" },
      { id: "show_december", label: "Show me December", kind: "ask" },
    ],
  },
  whats_the_risk: {
    bubbles: [
      "The 60-day terms. Cash dips to £41K in December (Forecast) before it recovers by February.",
    ],
    reaction: "concerned",
    replies: [
      { id: "ask_for_45", label: "Ask Boots for 45 days", kind: "hand_off", recommended: true },
      { id: "show_december", label: "Show me December", kind: "ask" },
      { id: "something_else", label: "Something else…", kind: "write" },
    ],
  },
};

function InteractiveDemo(args: AgentDeskProps) {
  const [messages, setMessages] = useState<DeskMessage[]>([]);
  const [replying, setReplying] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));

  const say = (text: string, id?: string) => {
    const mine: DeskMessage = {
      id: `f${Date.now()}`,
      author: "founder",
      bubbles: [text],
      at: new Date(),
      state: "sending",
    };
    setMessages((m) => [...m, mine]);
    later(250, () => {
      setMessages((m) => m.map((x) => (x.id === mine.id ? { ...x, state: "seen" } : x)));
      setReplying(true);
    });
    later(1900, () => {
      const a = (id && ANSWERS[id]) || {
        bubbles: ["I don't have that figure yet. I can find out once you say so."],
        replies: [
          { id: "why_that_one", label: "Why that one?", kind: "ask" as const, recommended: true },
          { id: "whats_the_risk", label: "What's the risk?", kind: "ask" as const },
        ],
      };
      setReplying(false);
      setMessages((m) => [
        ...m,
        {
          id: `a${Date.now()}`,
          author: "agent",
          bubbles: a.bubbles,
          at: new Date(),
          reaction: a.reaction ?? null,
          quickReplies: a.replies,
        },
      ]);
    });
  };

  return (
    <AgentDesk
      {...args}
      messages={messages}
      replying={replying}
      onQuickReply={(r) => say(r.say || r.label, r.id)}
      onSend={(text) => say(text)}
    />
  );
}
