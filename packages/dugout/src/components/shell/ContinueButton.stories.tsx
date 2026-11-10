import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { ContinueButton } from "./ContinueButton";
import { kitStyle } from "./KitBar";
import { NORTHWIND_KIT } from "./fixtures";
import { StopAllAgents } from "./StopAllAgents";
import type { ContinueState } from "./types";

const meta = {
  title: "Shell/ContinueButton",
  component: ContinueButton,
  parameters: { backgrounds: { value: "panel" }, docs: { description: { component: "At rest the brand primary with its light. Blocked is a solid red with ink text “Respond” and the count in a capsule, a 4 px red halo, and one 600 ms ring pulse when it turns blocked. Processing is a dark slab with a light arc orbiting its edge and “Pause”, for the whole run one press of Continue starts. A Customer Update is gold. Vacation is neutral with the caption and “Come back”. It keeps one width through its states. One pulse when pulseKey changes, never a loop; Space triggers the state's action." } } },
  args: { state: { kind: "idle" }, bindSpace: true },
} satisfies Meta<typeof ContinueButton>;
export default meta;
type Story = StoryObj<typeof meta>;

const STATES: Array<[string, ContinueState]> = [
  ["Idle", { kind: "idle" }],
  ["Blocked", { kind: "blocked", count: 3 }],
  ["Processing", { kind: "processing" }],
  ["Processing (a run)", { kind: "processing", run: true }],
  ["Customer Update", { kind: "matchday" }],
  ["Vacation (date)", { kind: "holiday", until: "2026-10-21" }],
  ["Vacation (condition)", { kind: "holiday", until: null, untilLabel: "the launch ships" }],
];

export const Idle: Story = {};
export const Blocked: Story = { args: { state: { kind: "blocked", count: 3 } } };
export const Processing: Story = { args: { state: { kind: "processing" } } };
/** One press of Continue keeps the team working (Nov 7, 2026): Pause stays for the whole run, between cycles too, and the tooltip says new cycles start on their own. */
export const ProcessingRun: Story = { name: "Processing (a run)", args: { state: { kind: "processing", run: true }, cycleNumber: 5 } };
/** Builder view off: the shell passes no cycle number, so the tooltip reads "The team is working". */
export const ProcessingBuilderViewOff: Story = { name: "Processing (Builder view off)", args: { state: { kind: "processing", run: true }, cycleNumber: null }, globals: { builderView: "off" } };
export const CustomerUpdate: Story = { args: { state: { kind: "matchday" } } };
/** The orchestrator is not reachable (first-time founder report, Nov 8, 2026): the button still reads Continue, and its tooltip says what a press does and does not do. */
export const WithCaveat: Story = { name: "Idle with a caveat", args: { state: { kind: "idle" }, caveat: "The orchestrator is not reachable: a press writes one note; no agent works." } };
/** The press has a price (first-time founder report, Nov 8, 2026): what the last cycle cost, as an Estimate, under the tooltip's sentence. */
export const WithCostHint: Story = { name: "Idle with the last cycle's cost", args: { state: { kind: "idle" }, hint: "Last cycle cost $0.52 · Estimate" } };
export const Holiday: Story = { name: "Vacation", args: { state: { kind: "holiday", until: "2026-10-21" } } };
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
/** On the brand slab, 34 px, as the top bar draws it. */
export const OnTheSlab: Story = {
  render: () => (
    <div className="kitbar-slab flex h-kitbar items-center gap-2 px-3 text-kit-on-primary" style={kitStyle(NORTHWIND_KIT)}>
      {STATES.filter(([label]) => label !== "Processing (a run)").slice(0, 5).map(([label, state]) => (
        <ContinueButton key={label} state={state} className="h-kitbar-chip rounded-track" />
      ))}
    </div>
  ),
};
