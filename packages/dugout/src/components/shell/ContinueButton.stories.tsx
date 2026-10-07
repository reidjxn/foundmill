import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { ContinueButton } from "./ContinueButton";
import { StopAllAgents } from "./StopAllAgents";
import type { ContinueState } from "./types";

const meta = {
  title: "Shell/ContinueButton",
  component: ContinueButton,
  parameters: { backgrounds: { value: "panel" }, docs: { description: { component: "At rest a kit-primary fill. Blocked is status-bad with “Respond · N”. Processing shows Pause and a 2 px sweep. Match Day is gold. Holiday is neutral with the caption and “Come back”. One 600 ms ring pulse when pulseKey changes, never a loop; Space triggers the state's action." } } },
  args: { state: { kind: "idle" }, bindSpace: true },
} satisfies Meta<typeof ContinueButton>;
export default meta;
type Story = StoryObj<typeof meta>;

const STATES: Array<[string, ContinueState]> = [
  ["Idle", { kind: "idle" }],
  ["Blocked", { kind: "blocked", count: 3 }],
  ["Processing", { kind: "processing" }],
  ["Customer Update", { kind: "matchday" }],
  ["Holiday (date)", { kind: "holiday", until: "2026-10-21" }],
  ["Holiday (condition)", { kind: "holiday", until: null, untilLabel: "the launch ships" }],
];

export const Idle: Story = {};
export const Blocked: Story = { args: { state: { kind: "blocked", count: 3 } } };
export const Processing: Story = { args: { state: { kind: "processing" } } };
export const CustomerUpdate: Story = { args: { state: { kind: "matchday" } } };
export const Holiday: Story = { args: { state: { kind: "holiday", until: "2026-10-21" } } };
export const AllStates: Story = {
  render: () => (
    <div className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3">
      {STATES.map(([label, state]) => (
        <div key={label} className="contents">
          <span className="t-label">{label}</span>
          <div>
            <ContinueButton state={state} />
          </div>
        </div>
      ))}
    </div>
  ),
};
function PulseDemo() {
  const [key, setKey] = useState(0);
  return (
    <div className="flex items-center gap-4">
      <ContinueButton state={{ kind: "idle" }} pulseKey={key} />
      <Button variant="ghost" onClick={() => setKey((k) => k + 1)}>
        Cycle finished → pulse once
      </Button>
    </div>
  );
}
export const Pulse: Story = { render: () => <PulseDemo /> };
export const WithStopAllAgents: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <ContinueButton state={{ kind: "processing" }} />
      <StopAllAgents onConfirm={() => new Promise<void>((r) => setTimeout(r, 900))} runningCount={7} className="text-secondary" />
    </div>
  ),
};
