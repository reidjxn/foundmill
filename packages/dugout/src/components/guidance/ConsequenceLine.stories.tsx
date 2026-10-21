import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { ConsequenceLine, consequenceText } from "./ConsequenceLine";
import { GuidanceProvider } from "./GuidanceProvider";

const meta = {
  title: "Guidance/ConsequenceLine",
  component: ConsequenceLine,
  parameters: {
    docs: {
      description: {
        component:
          "The line under any action that spends or commits (UX plan §6.2, principle 6): the consequence sentence, the cost as the caller formatted it, and whether it can be undone, with a warning triangle when it cannot. Unknown parts are left out, never written as “unknown”. **Always shown**, guidance on or off. `consequenceText()` is the same line as a string, for a two-line button's `description` (the DecisionBar's options).",
      },
    },
  },
  args: { consequence: "Stock-out risk in November.", cost: "€500.00 (Estimate)", reversible: false },
  decorators: [(Story) => <div className="w-96 p-4"><Story /></div>],
} satisfies Meta<typeof ConsequenceLine>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotReversible: Story = {};
export const Reversible: Story = { args: { consequence: "Pauses every agent until an owner or admin resumes them.", cost: "No cost", reversible: true } };
export const ConsequenceOnly: Story = { name: "Consequence only (cost and reversibility unknown)", args: { cost: undefined, reversible: undefined } };

/** Under the actions it belongs to: Stop all agents, Vacation, Forget, Apply to all agents, Go live. */
export const UnderActions: Story = {
  name: "Under actions",
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Button variant="danger" className="w-fit">
          Stop all agents
        </Button>
        <ConsequenceLine consequence="Every running task stops where it is." cost="No cost" reversible />
      </div>
      <div className="flex flex-col gap-1.5">
        <Button className="w-fit">Apply to all agents</Button>
        <ConsequenceLine consequence="Nine agents switch model and each runs its retest." cost="€3.20 (Estimate)" reversible />
      </div>
      <div className="flex flex-col gap-1.5">
        <Button variant="danger" className="w-fit">
          Forget this repository
        </Button>
        <ConsequenceLine consequence="The code stays on GitHub; the team loses its working copy." reversible={false} />
      </div>
      <Button variant="default" lines={2} description={consequenceText({ cost: "€500.00 (Estimate)", reversible: false })} className="w-64">
        Order the stock now
      </Button>
    </div>
  ),
};

/** Guidance off: still there. A consequence is information. */
export const GuidanceOff: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off" }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};
