import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ChannelKey } from "@foundmill/shared";
import { Button } from "../foundation/Button";
import { ChannelProfileCard } from "./ChannelProfileCard";
import { ChannelToken } from "./ChannelToken";
import { toggleChannel } from "./formation";
import { FormationBoard } from "./FormationBoard";
import { mockChannels } from "./mock";
import type { ChannelTokenData } from "./types";

function Board({ kit, animateEntrance = true }: { kit?: { primary: string; secondary?: string }; animateEntrance?: boolean }) {
  const [channels, setChannels] = useState<ChannelTokenData[]>(() => mockChannels());
  const [log, setLog] = useState<string[]>([]);
  const [key, setKey] = useState(0);
  const onToggle = (k: ChannelKey, enabled: boolean) => {
    setChannels((prev) => toggleChannel(prev, k, enabled));
    setLog((p) => [`${k} → ${enabled ? "board" : "bench"} (engine ${enabled ? "enabled" : "disabled"}, board re-scored)`, ...p].slice(0, 5));
  };
  return (
    <div className="flex w-[1040px] flex-col gap-3">
      <FormationBoard key={key} channels={channels} onToggle={onToggle} onOpenChannel={(k) => setLog((p) => [`open ${k}`, ...p].slice(0, 5))} onPause={(k, paused) => setChannels((prev) => prev.map((c) => (c.key === k ? { ...c, paused } : c)))} kit={kit} animateEntrance={animateEntrance} />
      <div className="flex items-start gap-3">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setChannels(mockChannels());
            setKey((k) => k + 1);
          }}
        >
          Replay entrance
        </Button>
        <ul className="font-mono text-mono text-secondary">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const meta = {
  title: "Agents/Channel Board",
  component: FormationBoard,
  parameters: { layout: "padded" },
  argTypes: { channels: { control: false } },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** On load all 15 fade in on the bench; the four recommended channels walk onto the board. Drag or press Enter to move a token; O opens it. */
export const RecommendationsWalkingOn: Story = { render: () => <Board /> };
export const SecondBrandColours: Story = { name: "Second brand colours", render: () => <Board kit={{ primary: "#B8303A", secondary: "#F2E8C9" }} /> };
export const StaticNoEntrance: Story = { render: () => <Board animateEntrance={false} /> };

export const Tokens: Story = {
  render: () => {
    const channels = mockChannels();
    return (
      <div className="flex flex-wrap gap-4 p-4">
        {channels.map((c) => (
          <ChannelToken key={c.key} channel={c} />
        ))}
      </div>
    );
  },
};

export const ProfileCard: Story = {
  render: () => {
    const paid = mockChannels().find((c) => c.key === "paid_ads")!;
    const print = mockChannels().find((c) => c.key === "print")!;
    return (
      <div className="flex gap-4">
        <div className="surface-overlay w-80 p-3">
          <ChannelProfileCard channel={paid} onOpenChannel={() => {}} onToggle={() => {}} onPause={() => {}} />
        </div>
        <div className="surface-overlay w-80 p-3">
          <ChannelProfileCard channel={print} onOpenChannel={() => {}} onToggle={() => {}} />
        </div>
      </div>
    );
  },
};
