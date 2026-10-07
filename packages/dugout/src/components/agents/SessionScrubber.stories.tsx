import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { AgentTile } from "./AgentTile";
import { generateMockSessionEvents, mockSessionSeed } from "./mock";
import { eventsUntil, reduceSessionEvents } from "./progress";
import { SessionScrubber, type ScrubberSpeed } from "./SessionScrubber";

const START = "2026-10-07T09:00:00Z";

function Replay({ outcome }: { outcome: "done" | "blocked" | "failed" }) {
  const events = useMemo(() => generateMockSessionEvents(`replay-${outcome}`, START, { outcome, shout: true, durationSec: 600 }), [outcome]);
  const seed = useMemo(() => mockSessionSeed(0, START), []);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<ScrubberSpeed>(8);
  const endedAt = events[events.length - 1]!.at;
  const session = useMemo(() => reduceSessionEvents(seed, eventsUntil(events, START, position)), [events, seed, position]);
  const now = new Date(Date.parse(START) + position);
  return (
    <div className="flex h-[620px] w-[900px] flex-col bg-base">
      <div className="min-h-0 flex-1">
        <AgentTile session={session} now={now} diffEngine="local" focused />
      </div>
      <SessionScrubber events={events} startedAt={START} endedAt={endedAt} position={position} onPositionChange={setPosition} playing={playing} onPlayingChange={setPlaying} speed={speed} onSpeedChange={setSpeed} />
    </div>
  );
}

const meta = {
  title: "Agents/SessionScrubber",
  component: SessionScrubber,
  parameters: { layout: "centered" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** Replay a recorded session: the tile is re-reduced from the events at the scrubber position; markers show phases, tests, the Shout and files. */
export const ReplayDone: Story = { render: () => <Replay outcome="done" /> };
export const ReplayBlocked: Story = { render: () => <Replay outcome="blocked" /> };
export const ReplayFailed: Story = { render: () => <Replay outcome="failed" /> };
