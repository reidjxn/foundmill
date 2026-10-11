import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { TreePalm } from "lucide-react";
import { Button } from "../foundation/Button";
import { HolidayDialog, type HolidaySettings } from "./HolidayDialog";
import { FIXTURE_TODAY } from "./fixtures";

const meta = {
  title: "Shell/VacationDialog",
  component: HolidayDialog,
  parameters: { docs: { description: { component: "BUILD §9.6: until (date / condition / until I return), the Chief of Staff's authority as decision types (hard gates locked), a budget ceiling and the events that wake the founder. Defaults: all non-gated types; kill switch, credential failure, legal deadline, runway warning." } } },
  args: { open: true, onOpenChange: () => {}, onSubmit: () => {}, today: FIXTURE_TODAY, currency: "EUR" },
} satisfies Meta<typeof HolidayDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
  const [open, setOpen] = useState(args?.open ?? false);
  const [result, setResult] = useState<HolidaySettings | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Button icon={TreePalm} onClick={() => setOpen(true)}>
        Go on vacation
      </Button>
      {result ? <pre className="t-mono rounded-panel bg-ink p-2 text-secondary">{JSON.stringify(result, null, 2)}</pre> : null}
      <HolidayDialog {...args} onSubmit={(s) => setResult(s)} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export const Open: Story = { render: (args) => <Frame {...args} /> };
export const WithInitial: Story = {
  args: { initial: { until: { kind: "condition", condition: "when the fall bundle ships" }, budgetCeiling: { amountMinor: 250000, currency: "EUR" }, authority: ["publish_content", "message_customers"] } },
  render: (args) => <Frame {...args} />,
};
export const Closed: Story = { args: { open: false }, render: (args) => <Frame {...args} /> };
