import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { ProvenanceChip } from "../foundation/Chip";
import { ApplyScopeDialog, type ApplyScope } from "./ApplyScopeDialog";

const meta = {
  title: "Shell/ApplyScopeDialog",
  component: ApplyScopeDialog,
  parameters: { docs: { description: { component: "“This agent only” / “Apply to all [type] agents” / “Apply to all agents” (BUILD §9.6), used by model, autonomy and negotiation settings." } } },
  args: { open: true, onOpenChange: () => {}, agentName: "Scout", agentType: "channel engine", typeCount: 4, allCount: 23, settingLabel: "Model: Sonnet → Opus", onApply: () => {} },
} satisfies Meta<typeof ApplyScopeDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
  const [open, setOpen] = useState(args?.open ?? false);
  const [scope, setScope] = useState<ApplyScope | null>(null);
  return (
    <div className="flex items-center gap-3">
      <Button onClick={() => setOpen(true)}>Change model</Button>
      {scope ? <span className="text-small text-secondary">Applied: {scope}</span> : null}
      <ApplyScopeDialog {...args} agentName={args?.agentName ?? ""} agentType={args?.agentType ?? ""} settingLabel={args?.settingLabel ?? ""} onApply={(s) => setScope(s)} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export const Open: Story = { render: (args) => <Frame {...args} /> };
export const Autonomy: Story = { args: { settingLabel: "Autonomy: Assisted → Automated", agentType: "specialist", typeCount: 8, defaultScope: "type" }, render: (args) => <Frame {...args} /> };
export const WithoutCounts: Story = { args: { typeCount: undefined, allCount: undefined, settingLabel: "Negotiation: on, walk-away €9.50 / unit" }, render: (args) => <Frame {...args} /> };
export const WithRetestNote: Story = {
  args: { extra: (scope) => <p className="text-small text-secondary">{scope === "agent" ? <>Re-testing its skills on Opus costs about <ProvenanceChip kind="estimate">$0.84</ProvenanceChip>.</> : "The other agents change model without a retest."}</p> },
  render: (args) => <Frame {...args} />,
};
