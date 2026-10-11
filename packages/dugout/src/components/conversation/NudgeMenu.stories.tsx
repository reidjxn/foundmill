import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { NudgeAck } from "./NudgeAck";
import { NudgeMenu, type Nudge, type NudgeMenuPreset } from "./NudgeMenu";

const ENGINEER: NudgeMenuPreset[] = [
  { key: "focus_on_tests", label: "Focus on tests", hint: "Make the acceptance tests pass before anything else." },
  { key: "simplify", label: "Simplify", hint: "Remove abstraction; the smallest change that works." },
  { key: "hurry_up", label: "Hurry up", hint: "Prefer smaller changes and ship sooner." },
];
const SPECIALIST: NudgeMenuPreset[] = [
  { key: "check_sources", label: "Check your sources", hint: "Quote the record behind every figure.", text: "Check your sources: quote the record behind every figure." },
  { key: "keep_it_small", label: "Keep it small", hint: "One change at a time, reversible.", text: "Keep it small: one change at a time." },
];

const meta = {
  title: "Conversation/NudgeMenu",
  component: NudgeMenu,
  parameters: {
    docs: {
      description: {
        component:
          "Nudge an agent with the presets that fit it (the persona's `nudges`), or a custom message of at most 280 characters. After a nudge the agent answers with one bubble in its own voice (NudgeAck), with no model call.",
      },
    },
  },
  args: { target: "Backend Engineer", presets: ENGINEER, onNudge: () => {}, labelled: true },
} satisfies Meta<typeof NudgeMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

/** An engineer's presets, labeled. */
export const Engineer: Story = {};

/** A specialist's presets, as the tile's icon button. */
export const Specialist: Story = { args: { target: "Certification Specialist", presets: SPECIALIST, labelled: false } };

function NudgeThenAck(args: Parameters<typeof NudgeMenu>[0]) {
  const [sent, setSent] = useState<Nudge | null>(null);
  return (
    <div className="flex flex-col gap-4 p-gutter">
      <NudgeMenu {...args} onNudge={setSent} />
      <div className="surface-panel relative h-40 w-96 p-panel-pad text-small text-secondary">
        Backend Engineer · Subscription pause and skip
        {sent ? <NudgeAck className="absolute bottom-3 left-3 right-3" name="Backend Engineer" avatarSeed="be-1" dept="dept-2" text="Understood." nudge={sent.text} /> : null}
      </div>
    </div>
  );
}

/** Nudge, then the agent's one-bubble acknowledgment over a tile. */
export const WithAcknowledgement: Story = { render: (args) => <NudgeThenAck {...args} /> };
