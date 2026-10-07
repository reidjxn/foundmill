import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { DecisionBar, type DecisionAnswer } from "./DecisionBar";
import { REORDER_OPTIONS } from "./fixtures";

const meta = {
  title: "Shell/DecisionBar",
  component: DecisionBar,
  parameters: { layout: "fullscreen", docs: { description: { component: "Sticky at the bottom of the reading pane, 64 px, bg-panel-alt. 2–4 options; the recommended one carries a thumbs-up and a kit-primary fill; hover or focus shows consequence, cost and reversibility; 1–4 choose; free text + Execute compiles a Plan (BUILD §11.3)." } } },
  args: { options: REORDER_OPTIONS, onChoose: () => {}, onExecute: () => {} },
  decorators: [
    (Story) => (
      <div className="flex h-72 flex-col justify-end bg-panel">
        <div className="t-reading flex-1 p-gutter text-secondary">
          Stock of the retinol serum covers 11 days at the current run rate. Meridian Labs quoted €9.20 a unit at 2,000 units (−8 % on the last order). Reordering now keeps the autumn bundle on sale; waiting costs about €1,100 a day in missed orders.
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
        note="Expires in 2 days"
      />
    );
}
export const Open: Story = { render: (args) => <OpenDemo {...args} /> };
export const TwoOptions: Story = { args: { options: REORDER_OPTIONS.slice(0, 2) } };
export const WithoutFreeText: Story = { args: { onExecute: undefined } };
export const Executing: Story = { args: { executing: true } };
export const Disabled: Story = { args: { disabled: true, note: "Only the owner can decide this" } };
export const Answered: Story = { args: { answered: { optionId: "a" }, onReopen: () => {} } };
export const AnsweredFreeText: Story = { args: { answered: { text: "ask for a quote and pause the Meta ads" } } };
