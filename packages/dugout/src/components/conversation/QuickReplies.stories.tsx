import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { QuickReplies } from "./QuickReplies";
import { CONCEPT_STARTERS, DECISION_STARTERS, JUNO_MESSAGES } from "./fixtures";
import type { QuickReplyItem } from "./types";

const meta = {
  title: "Conversation/QuickReplies",
  component: QuickReplies,
  parameters: {
    docs: {
      description: {
        component:
          "Always 2–4 when the founder is expected to respond (DIRECTION #6): numbered 1–4 with a key cap (Alt+1–4 where 1–4 are taken), the likeliest brand-tinted, rising in 40 ms apart, labels wrapping to two lines and never cut. A ghost Write reveals a one-line field: Enter sends, Escape closes.",
      },
    },
  },
  args: {
    replies: JUNO_MESSAGES[1]!.quickReplies!,
    agentName: "Juno",
    onChoose: () => undefined,
    onSend: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="surface-panel max-w-208 p-panel-pad">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof QuickReplies>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Juno's next replies: the recommended one is tinted; "Something else…" names the Write button. */
export const Default: Story = {};

/** An Inbox decision's openers. */
export const DecisionStarters: Story = { args: { replies: DECISION_STARTERS } };

/** Four starters on a concept. */
export const FourStarters: Story = {
  args: { replies: CONCEPT_STARTERS, agentName: "Research agent" },
};

/** Where 1–4 already belong to the DecisionBar: Alt+1–4. */
export const AltKeys: Story = { name: "Alt+1–4", args: { keyModifier: "alt" } };

/** Only one reply arrived: the row still offers two (the second is sent as typed text). */
export const PaddedToTwo: Story = {
  args: {
    replies: [
      {
        id: "go_with",
        label: "Go with: Approve the trial",
        kind: "choose_option",
        recommended: true,
      },
    ],
  },
};

const LONG: QuickReplyItem[] = [
  {
    id: "a",
    label: "Go with: Order two SKUs now and the serum later",
    kind: "choose_option",
    recommended: true,
  },
  { id: "b", label: "What would the gap cost us in November?", kind: "ask" },
  { id: "c", label: "Can Pennine split the batch?", kind: "ask" },
];
/** Long labels wrap to two lines inside a narrow column; nothing is cut. */
export const LongLabels: Story = {
  args: { replies: LONG },
  decorators: [
    (Story) => (
      <div className="max-w-80">
        <Story />
      </div>
    ),
  ],
};

/** The Write field open: Enter sends, Escape closes. */
export const Writing: Story = { args: { defaultWriting: true } };

/** One reply is being sent: it holds its pressed look; the others wait. */
export const Sending: Story = { args: { pendingId: "show_december" } };

/** Press one, or a number key: the last choice is shown below. */
export const Playground: Story = {
  render: (args) => {
    const Demo = () => {
      const [said, setSaid] = useState<string | null>(null);
      return (
        <div className="flex flex-col gap-3">
          <QuickReplies
            {...args}
            onChoose={(r) => setSaid(`Chose: ${r.label}`)}
            onSend={(t) => setSaid(`Wrote: ${t}`)}
          />
          <p className="text-small text-tertiary" aria-live="polite">
            {said ?? "Nothing chosen yet."}
          </p>
        </div>
      );
    };
    return <Demo />;
  },
};
