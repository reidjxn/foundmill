"use client";
/**
 * Two of the product's own screens on example data: four live agent tiles replaying recorded sessions and the Channel
 * Board, which is interactive. Each tile is one of the business's agents playing its own task's recording (terminal,
 * diff, preview, plan and notes from the example's data), opening mid-session in a different phase; when a session ends
 * it settles on its done state for a few seconds, or a session waiting for the founder is parked, and the agent picks up
 * its next task, for as long as the page is open. The ETA counts down against the replay's own clock, so it never reads
 * overdue. Under reduced motion the tiles hold one static frame.
 */
import { useState } from "react";
import { Radio } from "lucide-react";
import { AgentTile, Chip, FormationBoard, ProvenanceChip, TileGrid, toggleChannel, useLiveMockSessions, usePrefersReducedMotion, type AgentTileSession, type ChannelTokenData, type TileGridItem } from "@foundmill/dugout";
import { useExample } from "./examples/context";
import { exampleChannels } from "./examples/helpers";
import { LIVE_REPLAY } from "./examples/sessions/shared";
import { ProductWindow, Reveal, Section, SectionHeading, useMounted, useSeen } from "./parts";

type TileItem = TileGridItem & { session: AgentTileSession };

export function LiveSessions({ terminalRenderer }: { terminalRenderer?: "plain" | "xterm" }) {
  const mounted = useMounted();
  const [ref, seen] = useSeen<HTMLDivElement>("400px");
  return (
    <Section id="live">
      <SectionHeading id="live" eyebrow="Live sessions" title="Watch the work happen." lede="Every agent works in its own sandbox and streams what it is doing: terminal, diff, preview and plan. Nudge one, pause one, or stop them all with a single button." />
      <Reveal>
        <div ref={ref}>
          <ProductWindow
            title="Live sessions · 4 agents"
            chips={
              <span className="flex items-center gap-2">
                <Chip tone="neutral" icon={Radio}>
                  Recorded example, replayed
                </Chip>
                <ProvenanceChip kind="estimate" />
              </span>
            }
            glow="var(--dept-2)"
          >
            <div className="h-160 bg-base">{mounted && seen ? <LiveTiles terminalRenderer={terminalRenderer} /> : <div className="size-full animate-shimmer" />}</div>
          </ProductWindow>
        </div>
      </Reveal>
    </Section>
  );
}

function LiveTiles({ terminalRenderer }: { terminalRenderer?: "plain" | "xterm" }) {
  const { sessions } = useExample();
  const reduced = usePrefersReducedMotion();
  const live = useLiveMockSessions(4, { ...LIVE_REPLAY, script: sessions, running: !reduced });
  const [focused, setFocused] = useState<string | null>(null);
  const items: TileItem[] = live.sessions.map((s) => ({ id: s.id, label: `${s.agent.name}: ${s.task.title}`, avatar: { name: s.agent.name, seed: s.agent.seed, dept: s.agent.dept, status: s.agent.status }, session: s }));
  const noop = () => {};
  return (
    <TileGrid
      items={items}
      focusedId={focused}
      onFocusedChange={setFocused}
      aria-label="Example agent sessions"
      renderTile={(item, ctx) => (
        <AgentTile
          session={item.session}
          focused={ctx.focused}
          compact={ctx.compact}
          now={live.now}
          diffEngine="local"
          terminalRenderer={terminalRenderer}
          onFocus={(id) => setFocused(focused === id ? null : id)}
          controls={{ onPause: noop, onResume: noop, onShout: noop, onReassign: noop, onUpgradeModel: noop, onStop: noop }}
        />
      )}
    />
  );
}

export function Channels() {
  const business = useExample();
  const [channels, setChannels] = useState<ChannelTokenData[]>(() => exampleChannels(business));
  return (
    <Section id="channels">
      <div className="flex items-end justify-between gap-10">
        <SectionHeading id="channels" eyebrow="Distribution" title="Fifteen channels. The right few first." lede="The Distribution Strategist scores every channel 1–20 for fit, puts the strongest on the board within your runway, and shows you why. Drag a channel on or off to try it." />
        <span className="flex shrink-0 items-center gap-2 pb-1">
          <Chip tone="neutral">Example business</Chip>
          <ProvenanceChip kind="estimate" />
        </span>
      </div>
      <Reveal>
        <FormationBoard channels={channels} onToggle={(k, on) => setChannels((prev) => toggleChannel(prev, k, on))} hoverCards={false} />
      </Reveal>
    </Section>
  );
}
