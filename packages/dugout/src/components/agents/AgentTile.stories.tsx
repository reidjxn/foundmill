import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { AgentTile, type AgentTileProps } from "./AgentTile";
import { generateMockSessionEvents, mockSessionSeed, mockSpecialistData } from "./mock";
import { reduceSessionEvents } from "./progress";
import { SpecialistTile } from "./SpecialistTile";
import type { AgentTileSession, Shout, TileControls } from "./types";
import { useLiveMockSessions } from "./useLiveMockSessions";

const START = "2026-10-07T09:00:00Z";
const NOW = new Date("2026-10-07T09:11:30Z");

function session(i: number, outcome: "done" | "blocked" | "failed" | "running", shout = true): AgentTileSession {
  return reduceSessionEvents(mockSessionSeed(i, START), generateMockSessionEvents(i, START, { outcome, shout, durationSec: 600 }));
}

const SCREENSHOT =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#f6f3ee"/><rect x="64" y="64" width="380" height="380" rx="8" fill="#e4ded4"/><text x="490" y="120" font-family="Inter, sans-serif" font-size="32" fill="#1b1b1b">Overnight Repair Serum</text><text x="490" y="160" font-family="Inter, sans-serif" font-size="16" fill="#555">Bundle size</text><rect x="490" y="180" width="110" height="44" rx="6" fill="#2f6f5e"/><text x="520" y="208" font-family="Inter, sans-serif" font-size="15" fill="#fff">Single</text><rect x="612" y="180" width="110" height="44" rx="6" fill="#fff" stroke="#2f6f5e"/><text x="648" y="208" font-family="Inter, sans-serif" font-size="15" fill="#2f6f5e">Trio</text><rect x="734" y="180" width="110" height="44" rx="6" fill="#fff" stroke="#2f6f5e"/><text x="760" y="208" font-family="Inter, sans-serif" font-size="15" fill="#2f6f5e">Six-pack</text><text x="490" y="270" font-family="Inter, sans-serif" font-size="28" fill="#1b1b1b">€42.00</text></svg>',
  );

const controls = (log: (s: string) => void): TileControls => ({
  onPause: (id) => log(`pause ${id}`),
  onResume: (id) => log(`resume ${id}`),
  onShout: (id, s: Shout) => log(`nudge ${id}: ${s.text}`),
  onReassign: (id) => log(`reassign ${id}`),
  onUpgradeModel: (id) => log(`upgrade ${id}`),
  onStop: (id) => log(`stop ${id}`),
  onOpenInClaudeCode: (id) => log(`open ${id} in Claude Code`),
});

const meta = {
  title: "Agents/AgentTile",
  component: AgentTile,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[520px] w-[760px] bg-base p-4">
        <Story />
      </div>
    ),
  ],
  args: { session: session(0, "running"), now: NOW, diffEngine: "monaco" },
  argTypes: { session: { control: false }, controls: { control: false }, now: { control: false } },
} satisfies Meta<typeof AgentTile>;
export default meta;
type Story = StoryObj<typeof meta>;

function LiveTile(args: AgentTileProps) {
  const live = useLiveMockSessions(1, { intervalMs: 350 });
  const [log, setLog] = useState<string[]>([]);
  const s = live.sessions[0];
  if (!s) return <></>;
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1">
        <AgentTile {...args} session={s} now={live.now} controls={controls((l) => setLog((p) => [l, ...p].slice(0, 4)))} />
      </div>
      <ul className="h-16 overflow-hidden font-mono text-mono text-secondary">
        {log.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

/** A session streaming from its recorded script: stdout arrives in bursts, the ring follows the §11.6 formula. */
export const Live: Story = { render: (args) => <LiveTile {...args} /> };

export const Terminal: Story = { args: { defaultView: "terminal" } };
export const Diff: Story = { args: { defaultView: "diff" } };
export const DiffLocalEngine: Story = { name: "Diff (local engine fallback)", args: { defaultView: "diff", diffEngine: "local" } };
export const Plan: Story = { args: { defaultView: "plan" } };
export const Preview: Story = {
  args: { defaultView: "preview", session: { ...session(0, "running"), preview: { screenshotUrl: SCREENSHOT, capturedAt: "2026-10-07T09:10:00Z", url: null } } },
};
export const Focused: Story = { args: { focused: true, controls: controls(() => {}) } };
/** Guidance on (the default): the header's visible "…" opens the same actions as the hover toolbar, so hovering is never the only path. */
export const GuidedActionsMenu: Story = { name: "Guided · actions menu", args: { controls: controls(() => {}) } };
/** Guidance off: no "…"; the hover toolbar is the only control surface, as before. */
export const GuidanceOff: Story = {
  name: "Guidance off",
  args: { controls: controls(() => {}) },
  render: (args) => (
    <GuidanceProvider value={{ guidance: "off" }}>
      <AgentTile {...args} />
    </GuidanceProvider>
  ),
};
export const Compact: Story = {
  decorators: [
    (Story) => (
      <div className="h-[220px] w-[340px] bg-base">
        <Story />
      </div>
    ),
  ],
  args: { compact: true, controls: controls(() => {}) },
};
export const WaitingForApproval: Story = { args: { session: session(3, "blocked"), controls: controls(() => {}) } };
export const Failed: Story = { args: { session: session(5, "failed", false), controls: controls(() => {}) } };
export const Done: Story = { args: { session: session(4, "done"), defaultView: "plan" } };
export const Paused: Story = { args: { session: { ...session(1, "running"), status: "paused" }, controls: controls(() => {}) } };

/** Specialist tiles replace the terminal with the RFQ funnel, quote table, sample tracker and shipment list. */
export const Specialist: Story = {
  render: (args) => {
    const s = { ...session(5, "running", false), agent: { ...session(5, "running").agent, name: "Halvard", role: "Sourcing and manufacturing" }, task: { id: "task-s1", title: "Serum pump: 20 suppliers, three samples", href: "#" } };
    return <SpecialistTile session={s} data={mockSpecialistData()} now={args.now} controls={controls(() => {})} />;
  },
};

/**
 * Specialist tiles with nothing in a view yet: each says what it is missing in its own state, over its own brief (the
 * task's goal), so a row of them never repeats one generic sentence.
 */
export const SpecialistEmpty: Story = {
  name: "Specialist · empty views",
  render: (args) => {
    const base = session(5, "running", false);
    const empty = { rfq: [], quotes: [], samples: [], shipments: [] };
    const tiles = [
      { status: "running" as const, name: "Sourcing and Manufacturing Specialist", title: "Second batch purchase order pack", goal: "Assemble the PO pack for batch 002 across three SKUs with quote ids and the landed-cost model; the founder signs." },
      { status: "review" as const, name: "Formulation Chemist", title: "Stability data for serum reformulation", goal: "Collate 12-week stability results for serum v3 and flag any drift beyond spec." },
      { status: "paused" as const, name: "Packaging and Industrial Design Specialist", title: "Carton artwork proof round 2", goal: "Review the second proof for the refill carton against the labeling checklist." },
    ];
    return (
      <div className="grid grid-cols-3 gap-2" style={{ width: 1000, height: 320 }}>
        {tiles.map((t, i) => (
          <SpecialistTile key={t.name} session={{ ...base, id: `sp-${i}`, status: t.status, phase: t.status === "review" ? "review" : "implementing", agent: { ...base.agent, name: t.name }, task: { id: `task-sp${i}`, title: t.title, href: "#", kind: "specialist", goal: t.goal } }} data={empty} now={args.now} controls={controls(() => {})} />
        ))}
      </div>
    );
  },
};

/** No output yet while the session runs: a live prompt with a blinking caret and the agent's name, never a black void. */
export const EmptyTerminalLive: Story = {
  name: "Empty terminal · live",
  args: { session: { ...session(2, "running"), status: "running", stdout: [] }, defaultView: "terminal", terminalRenderer: "plain" },
  render: (args) => (
    <div style={{ width: 380, height: 300 }}>
      <AgentTile {...args} />
    </div>
  ),
};

/** No output and not running: a quiet idle note. */
export const EmptyTerminalIdle: Story = {
  name: "Empty terminal · idle",
  args: { session: { ...session(2, "running"), status: "paused", stdout: [] }, defaultView: "terminal", terminalRenderer: "plain" },
  render: (args) => (
    <div style={{ width: 380, height: 300 }}>
      <AgentTile {...args} />
    </div>
  ),
};

/** Waiting for its first output, with the task's goal under the prompt (the brief), so two waiting tiles never read alike. */
export const EmptyTerminalWithGoal: Story = {
  name: "Empty terminal · with goal",
  args: { session: { ...session(2, "running"), status: "running", stdout: [], task: { ...session(2, "running").task, goal: "Add pause and skip to the refill subscription through the commerce connector in mock mode." } }, defaultView: "terminal", terminalRenderer: "plain" },
  render: (args) => (
    <div style={{ width: 380, height: 300 }}>
      <AgentTile {...args} />
    </div>
  ),
};

/**
 * Narrow tiles (under 600 px): name over task on a row of their own at the tile's full width, then phase, progress and
 * icon-only view tabs on a second row; the footer drops tokens first. Long names read in full.
 */
export const Narrow: Story = {
  args: { session: session(1, "running"), controls: controls(() => {}) },
  render: (args) => (
    <div className="grid grid-cols-2 gap-2" style={{ width: 640, height: 300 }}>
      <AgentTile {...args} />
      <AgentTile {...args} session={{ ...session(3, "blocked"), agent: { ...session(3, "blocked").agent, name: "Sourcing and Manufacturing Specialist" } }} />
    </div>
  ),
};
