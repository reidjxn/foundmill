import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DevelopmentChart } from "./DevelopmentChart";
import { HealthBadge } from "./HealthBadge";
import { HierarchyChart } from "./HierarchyChart";
import { mockDevelopmentSeries, mockHierarchy, mockPositionRoles, mockTraits } from "./mock";
import { PositionMap } from "./PositionMap";
import { TraitChips } from "./TraitChips";
import type { HierarchyNode } from "./types";

const NOW = new Date("2026-10-07T09:30:00Z");

const meta = {
  title: "Agents/Profile",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

/** "Other roles it could take": role cells tinted Excellent / Good / Average / Poor in the rating ramp, with the band word and the 1–20 fit. */
export const Positions: Story = {
  name: "Other roles it could take",
  render: () => (
    <div className="w-[760px]">
      <PositionMap roles={mockPositionRoles()} currentRoleId="frontend" onSelect={() => {}} />
    </div>
  ),
};

export const Traits: Story = { render: () => <TraitChips traits={mockTraits()} /> };

/** Skill history lines in the department color; training sessions as diamonds (filled when promoted). */
export const Development: Story = {
  render: () => {
    const { series, sessions } = mockDevelopmentSeries();
    return <DevelopmentChart series={series} sessions={sessions} dept="dept-2" width={760} aria-label="Juno: skill development since July" />;
  },
};

/** Server-safe, so the caller passes the signed-in person's date format (`useDateFormat()`): ISO axis labels. */
export const DevelopmentIsoDates: Story = {
  name: "Development · ISO dates",
  render: () => {
    const { series, sessions } = mockDevelopmentSeries();
    return <DevelopmentChart series={series} sessions={sessions} dept="dept-2" width={760} aria-label="Juno: skill development since July" datePrefs={{ date: "iso", time: "24h" }} />;
  },
};

export const Health: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <HealthBadge status="healthy" details={{ lastHeartbeatAt: "2026-10-07T09:29:40Z", errorRate: 0.004 }} now={NOW} inline />
      <HealthBadge status="degraded" details={{ lastHeartbeatAt: "2026-10-07T09:20:00Z", errorRate: 0.18, reason: "Three retries on the GitHub connector in the last hour" }} now={NOW} inline />
      <HealthBadge status="failing" details={{ loopDetected: true, lastHeartbeatAt: "2026-10-07T09:12:00Z" }} now={NOW} inline />
      <HealthBadge status="injured" details={{ expectedReturnAt: "2026-10-07T12:00:00Z", reason: "Shopify token expired; reconnect in Settings → Integrations" }} now={NOW} inline />
      <HealthBadge status="paused" now={NOW} inline />
      <div className="flex gap-3">
        <HealthBadge status="injured" details={{ expectedReturnAt: "2026-10-07T12:00:00Z" }} now={NOW} />
        <HealthBadge status="degraded" details={{ errorRate: 0.1 }} now={NOW} />
      </div>
    </div>
  ),
};

function HierarchyDemo() {
  const [selected, setSelected] = useState<HierarchyNode | null>(null);
  return (
    <div className="w-[1200px]">
      <HierarchyChart nodes={mockHierarchy()} selectedId={selected?.id} onSelect={setSelected} />
      <p className="mt-2 text-small text-secondary">{selected ? `${selected.name} · ${selected.role}` : "Select a node"}</p>
    </div>
  );
}

/** Org chart: founder → Chief of Staff → leads → workers. Arrow keys walk the tree. */
export const Hierarchy: Story = { render: () => <HierarchyDemo /> };

/**
 * The same chart in a panel narrower than the tree: the gaps tighten and the nodes narrow (smaller avatar, the role on
 * its own line) until it fits without a sideways scroll. The founder's staff sit beside the Chief of Staff.
 */
export const HierarchyFitted: Story = {
  render: () => (
    <div className="h-[560px] w-[960px] rounded-md border border-line">
      <HierarchyChart nodes={mockHierarchy()} className="h-full" />
    </div>
  ),
};
