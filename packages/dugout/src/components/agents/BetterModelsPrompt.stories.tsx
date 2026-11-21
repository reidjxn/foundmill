import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { BetterModelsPrompt } from "./BetterModelsPrompt";
import { ModelPicker } from "./ModelPicker";
import type { ModelOption } from "./types";

const meta = { title: "Agents/BetterModelsPrompt", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj;

const money = (amountMinor: number) => ({ amountMinor, currency: "USD" });
const OPTIONS: ModelOption[] = [
  { key: "opus", label: "Opus", description: "Deepest judgment; the default for the agent that plans the work.", skillDelta: null, wageDelta: money(900) },
  { key: "sonnet", label: "Sonnet", description: "Fast and capable; the default for workers.", skillDelta: null, wageDelta: money(300) },
  { key: "haiku", label: "Haiku 5.5", description: "Low cost; utility work.", skillDelta: null, wageDelta: money(-100) },
  { key: "glm", label: "GLM-5.3 Flash", description: "Low cost; runs the work sessions of a free team.", skillDelta: null, wageDelta: money(-150) },
];

function Demo({ options, value, inUse, prompt }: { options: ModelOption[]; value: ModelOption["key"]; inUse: ModelOption["key"]; prompt?: boolean }) {
  const [open, setOpen] = useState(prompt ?? false);
  return (
    <div className="w-[640px]">
      <ModelPicker options={options} value={value} inUse={inUse} onChange={(m) => options.find((o) => o.key === m)?.gated && setOpen(true)} />
      <BetterModelsPrompt planLabel="Try" open={open} onOpenChange={setOpen} onSeePlans={() => setOpen(false)} onConnectKey={() => setOpen(false)} />
    </div>
  );
}

/** Free plan, GLM-5.3 Flash in use: Opus and Sonnet are grayed but selectable; choosing one opens the prompt. */
export const InUseGlm: Story = { render: () => <Demo options={OPTIONS.map((o) => (o.key === "opus" || o.key === "sonnet" ? { ...o, gated: true as const } : o))} value="glm" inUse="glm" /> };

/** The prompt itself: two ways to Claude, and "Not now". */
export const Gated: Story = { render: () => <Demo options={OPTIONS.map((o) => (o.key === "opus" || o.key === "sonnet" ? { ...o, gated: true as const } : o))} value="glm" inUse="glm" prompt /> };

/** A stored Opus is kept for after an upgrade, and the team runs on GLM-5.3 Flash meanwhile. */
export const StoredChoiceKept: Story = { render: () => <Demo options={OPTIONS.map((o) => (o.key === "opus" || o.key === "sonnet" ? { ...o, gated: true as const } : o))} value="opus" inUse="glm" /> };

/** Own Anthropic key connected: nothing is gated, and there is no GLM option. */
export const OwnKeyConnected: Story = { render: () => <Demo options={OPTIONS.filter((o) => o.key !== "glm")} value="sonnet" inUse="sonnet" /> };
