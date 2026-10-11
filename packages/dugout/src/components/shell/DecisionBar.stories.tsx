import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DecisionBar, type DecisionAnswer } from "./DecisionBar";
import { REORDER_OPTIONS } from "./fixtures";

const meta = {
  title: "Shell/DecisionBar",
  component: DecisionBar,
  parameters: { layout: "fullscreen", docs: { description: { component: "Sticky at the bottom of the reading pane, at least 64 px, glass (surface 2 at 86% over a 16 px blur) with a top light line and an upward shadow. Left: “Your call” and the deadline (above the options in a narrow pane). 2–4 options on an even grid of two-line buttons, each with its own consequence line; the recommended one is primary with a thumbs-up and a Recommended tag. Options wrap and the bar grows — nothing truncates or overlaps. Hover or focus shows consequence, cost and reversibility; 1–4 choose. With `onAsk`, “Ask <agent>” opens the conversation in place of the free-text box; without it, free text + Execute compiles a Plan (BUILD §11.3)." } } },
  args: { options: REORDER_OPTIONS, onChoose: () => {}, onExecute: () => {} },
  decorators: [
    (Story) => (
      <div className="flex h-72 flex-col justify-end bg-panel">
        <div className="t-reading flex-1 p-gutter text-secondary">
          Stock of the retinol serum covers 11 days at the current run rate. Meridian Labs quoted €9.20 a unit at 2,000 units (−8% on the last order). Reordering now keeps the fall bundle on sale; waiting costs about €1,100 a day in missed orders.
        </div>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DecisionBar>;
export default meta;
type Story = StoryObj<typeof meta>;

function OpenDemo(args: Story["args"]) {
    const [answered, setAnswered] = useState<DecisionAnswer | undefined>();
    const [executing, setExecuting] = useState(false);
    return (
      <DecisionBar
        {...args}
        options={args?.options ?? REORDER_OPTIONS}
        answered={answered}
        executing={executing}
        onChoose={(o) => setAnswered({ optionId: o.id })}
        onExecute={(text) => {
          setExecuting(true);
          setTimeout(() => {
            setExecuting(false);
            setAnswered({ text });
          }, 900);
        }}
        onReopen={() => setAnswered(undefined)}
        deadline="Expires in 2 days"
      />
    );
}
export const Open: Story = { render: (args) => <OpenDemo {...args} /> };
export const TwoOptions: Story = { args: { options: REORDER_OPTIONS.slice(0, 2) } };
export const WithoutFreeText: Story = { args: { onExecute: undefined } };
export const Executing: Story = { args: { executing: true } };
export const Disabled: Story = { args: { disabled: true, note: "Only the owner can decide this" } };
/** DIRECTION #7: “Ask Juno” replaces the free-text box; typing is optional, never required. */
export const WithAsk: Story = { name: "Ask instead of typing", args: { onExecute: undefined, onAsk: () => {}, askLabel: "Ask Juno", deadline: "Expires in 5 days", keyHints: true } };
/** The 1280 window: the reading pane is 668 px, “Your call” moves above the options and they wrap. */
export const NarrowPane: Story = {
  name: "Reading pane at 1280",
  args: { deadline: "Expires in 5 days" },
  decorators: [
    (Story) => (
      <div style={{ width: 668 }}>
        <Story />
      </div>
    ),
  ],
};
export const NoConsequences: Story = {
  name: "Options without consequences",
  args: { options: [{ id: "y", label: "Approve", recommended: true, cost: null, reversible: true }, { id: "n", label: "Decline", reversible: true }, { id: "w", label: "Wait a week" }], deadline: "Expires today" },
};
export const Answered: Story = { args: { answered: { optionId: "a" }, onReopen: () => {} } };
export const AnsweredFreeText: Story = { args: { answered: { text: "ask for a quote and pause the Meta ads" } } };
