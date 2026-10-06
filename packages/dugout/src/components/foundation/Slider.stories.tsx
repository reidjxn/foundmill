import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { formatMoney } from "../../lib/format";
import { Slider } from "./Slider";

const meta = {
  title: "Foundation/Slider",
  component: Slider,
  args: { defaultValue: [40], max: 100, step: 1, thumbLabels: ["Budget"], className: "w-64" },
  argTypes: { tone: { control: "select", options: ["kit", "good", "warn", "bad", "info", "gold"] } },
} satisfies Meta<typeof Slider>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Range: Story = { args: { defaultValue: [20, 60], thumbLabels: ["Minimum", "Maximum"] } };
export const Disabled: Story = { args: { disabled: true } };

function Budget() {
  const [v, setV] = useState([250_00]);
  return (
    <div className="flex w-72 flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="t-label">Weekly ceiling</span>
        <span className="t-display-sm tabular-nums">{formatMoney({ amountMinor: v[0] ?? 0, currency: "EUR" })}</span>
      </div>
      <Slider value={v} onValueChange={setV} min={0} max={2000_00} step={10_00} thumbLabels={["Weekly ceiling"]} tone={(v[0] ?? 0) > 1500_00 ? "warn" : "kit"} />
    </div>
  );
}
export const WithValue: Story = { render: () => <Budget /> };
