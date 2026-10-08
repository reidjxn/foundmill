import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../foundation/Button";
import { AgentTile } from "./AgentTile";
import { mockTaskGraph } from "./mock";
import { TaskGraph } from "./TaskGraph";
import { GroundViewToggle, TileGrid, type GroundView, type TileGridItem } from "./TileGrid";
import type { AgentTileSession } from "./types";
import { useLiveMockSessions } from "./useLiveMockSessions";

type Item = TileGridItem & { session: AgentTileSession };

function toItems(sessions: AgentTileSession[]): Item[] {
  return sessions.map((s) => ({ id: s.id, label: `${s.agent.name}: ${s.task.title}`, avatar: { name: s.agent.name, seed: s.agent.seed, dept: s.agent.dept, status: s.agent.status }, session: s }));
}

function Ground({ count, intervalMs = 400, defaultFocusedId = null }: { count: number; intervalMs?: number; defaultFocusedId?: string | null }) {
  const live = useLiveMockSessions(count, { intervalMs });
  const [view, setView] = useState<GroundView>("tiles");
  const [focused, setFocused] = useState<string | null>(defaultFocusedId);
  const items = toItems(live.sessions);
  return (
    <div className="flex h-screen flex-col bg-base">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-subtle bg-panel px-4">
        <span className="t-label">Live sessions · {count} agents</span>
        <span className="flex-1" />
        <GroundViewToggle value={view} onChange={setView} />
        <Button size="sm" variant="ghost" onClick={live.reset}>
          Restart replay
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {view === "tiles" ? (
          <TileGrid
            items={items}
            focusedId={focused}
            onFocusedChange={setFocused}
            renderTile={(item, ctx) => (
              <AgentTile
                session={item.session}
                focused={ctx.focused}
                compact={ctx.compact}
                now={live.now}
                diffEngine="local"
                onFocus={(id) => setFocused(focused === id ? null : id)}
                controls={{ onPause: () => {}, onResume: () => {}, onShout: () => {}, onReassign: () => {}, onUpgradeModel: () => {}, onStop: () => {} }}
              />
            )}
          />
        ) : (
          <div className="p-4">
            <TaskGraph nodes={mockTaskGraph()} height={560} />
          </div>
        )}
      </div>
    </div>
  );
}

const meta = {
  title: "Agents/TileGrid",
  component: TileGrid,
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** Sixteen live mock tiles streaming fake events on a 4×4 grid (compact tiles). Click a tile or press Enter to focus it. */
export const SixteenLive: Story = { render: () => <Ground count={16} /> };
/** A focused tile takes two thirds of the width; the rest sit in a rail. Esc leaves focus mode. */
export const FocusedTile: Story = { render: () => <Ground count={9} defaultFocusedId="session-1" /> };
export const FourTiles: Story = { render: () => <Ground count={4} intervalMs={300} /> };
/** Beyond 24 tiles the rest sit in the overflow strip; focusing one from the strip brings it on screen. */
export const ThirtyWithOverflow: Story = { render: () => <Ground count={30} intervalMs={500} /> };
export const SingleTile: Story = { render: () => <Ground count={1} intervalMs={250} /> };
