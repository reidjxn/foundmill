import type { Meta, StoryObj } from "@storybook/react-vite";
import { DecisionLead } from "./DecisionLead";

const meta: Meta<typeof DecisionLead> = {
  title: "Shell/DecisionLead",
  component: DecisionLead,
  parameters: { layout: "padded" },
  args: {
    agentName: "Juno",
    recommended: { id: "go", label: "Run the sale", recommended: true, consequence: "A 20% discount for a week.", cost: { amountMinor: 4000, currency: "USD" }, reversible: true },
    others: [{ id: "wait", label: "Wait a week", cost: null, reversible: true }],
    onChoose: () => {},
    onAsk: () => {},
  },
};
export default meta;
type Story = StoryObj<typeof DecisionLead>;

export const Suggestion: Story = {};
export const CannotBeUndone: Story = { args: { recommended: { id: "sign", label: "Send the contract", recommended: true, cost: null, reversible: false } } };
export const Locked: Story = { args: { disabled: true } };
