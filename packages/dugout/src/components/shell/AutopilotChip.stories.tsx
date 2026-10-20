import type { Meta, StoryObj } from "@storybook/react-vite";
import { AutopilotChip } from "./AutopilotChip";

const meta = {
  title: "Shell/AutopilotChip",
  component: AutopilotChip,
  parameters: { docs: { description: { component: "Autopilot's state on Home: the word Autopilot, a status pill (icon + word, never color alone) and, while it is on or waiting, the next planned cycle with the dashed Estimate tag. Amber while it waits for the founder, red when a guard rail paused it. A button when it opens Settings › Mode; the tooltip says why in plain words. With `guide`, in guided mode, one sentence beside it says what Autopilot does and never does." } } },
  args: { state: "on", label: "On", nextAt: "2026-10-14T15:45:00.000Z", detail: "Autopilot is running the business." },
} satisfies Meta<typeof AutopilotChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const On: Story = {};
export const WaitingForYou: Story = { args: { state: "waiting", label: "Waiting for you", detail: "Waiting for you: 2 Inbox items need your decision. Autopilot never decides for you." } };
export const PausedCredits: Story = { args: { state: "paused", label: "Paused: credits used up", nextAt: null, detail: "This month's credits are used up, so Autopilot paused. Top up in Settings › Billing, then turn Autopilot back on." } };
export const PausedStop: Story = { args: { state: "paused", label: "Paused: agents stopped", nextAt: null, detail: "Stop all agents was pressed, so Autopilot paused. Resume the agents, then turn Autopilot back on." } };
export const Off: Story = { args: { state: "off", label: "Off", nextAt: null, detail: "Cycles start when you press Continue." } };
export const AsButton: Story = { args: { onClick: () => {} } };
/** Home in guided mode: the one sentence that tells Autopilot apart from Continue and from a vacation (UX plan B16). */
export const WithGuide: Story = { name: "With the guided sentence", args: { guide: true, onClick: () => {} } };
