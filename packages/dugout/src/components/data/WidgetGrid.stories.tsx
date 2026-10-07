import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { Bot, Inbox, LineChart, ListChecks, Trophy, Users } from "lucide-react";
import { StatusPill } from "../foundation/StatusPill";
import { Avatar, AvatarStack } from "../foundation/Avatar";
import { Sparkline } from "../foundation/Sparkline";
import { Timeline } from "./Lists";
import { MetricTile, StatusStrip } from "./MetricTile";
import { WidgetGrid } from "./WidgetGrid";
import {
  DEMO_WIDGET_REGISTRY,
  FIXTURE_NOW,
  FOUNDERS_VIEW_LAYOUT,
  WIDGET_PRESETS,
} from "./fixtures";
import type { WidgetLayout, WidgetRegistryEntry } from "./types";

const SPARK = [12, 14, 13, 15, 18, 17, 19, 22, 21, 24];

const renderers: Record<string, WidgetRegistryEntry["render"]> = {
  journey_ribbon: ({ size }) => (
    <div className="flex h-full items-end bg-base px-3 pb-2" style={{ minHeight: size.height }}>
      <Sparkline
        data={SPARK}
        width={Math.max(100, size.width - 24)}
        height={Math.max(40, size.height - 24)}
        className="text-kit-primary"
        fill
      />
    </div>
  ),
  status_strip: () => (
    <StatusStrip
      className="rounded-none border-0"
      tiles={[
        {
          label: "Cash",
          value: { amountMinor: 18_420_000, currency: "EUR" },
          delta: { value: -0.04, percent: true, goodWhen: "up", label: "30 d" },
        },
        {
          label: "Runway",
          value: 11.4,
          format: "decimal",
          unit: "mo",
          estimate: "forecast",
          delta: { value: -0.6, label: "vs last month" },
        },
        {
          label: "Revenue",
          value: { amountMinor: 2_410_000, currency: "EUR" },
          spark: SPARK,
          delta: { value: 0.12, percent: true },
        },
        { label: "Customers this week", value: 31, format: "integer", delta: { value: 7 } },
        { label: "Business health", value: "Good", caption: "4 of 6 departments healthy" },
      ]}
    />
  ),
  department_card: ({ settings }) => (
    <div className="flex h-full flex-col gap-2 p-panel-pad">
      <div className="flex items-center gap-2">
        <span className="t-display-sm capitalize text-primary">{String(settings.department)}</span>
        <StatusPill tone="good">Healthy</StatusPill>
      </div>
      <AvatarStack
        items={[
          { name: "Scout", agent: { seed: "scout", dept: "dept-3" }, status: "healthy" },
          { name: "Mailer", agent: { seed: "mailer", dept: "dept-3" }, status: "degraded" },
          { name: "Signal", agent: { seed: "signal", dept: "dept-3" }, status: "idle" },
        ]}
      />
      <p className="text-body text-secondary">
        Now: Scout is qualifying 12 leads from the trade show list.
      </p>
      <MetricTile
        label="Blended cost per customer"
        value={{ amountMinor: 3_120, currency: "EUR" }}
        spark={SPARK}
        delta={{ value: -0.08, percent: true, goodWhen: "down" }}
        className="p-0"
      />
    </div>
  ),
  inbox_preview: ({ settings }) => (
    <ul className="flex flex-col">
      {Array.from({ length: Number(settings.rows ?? 4) }, (_, i) => (
        <li
          key={i}
          className="flex h-row-comfortable items-center gap-2 border-b hairline-50 px-panel-pad text-body"
        >
          <Avatar size={20} name="Scout" agent={{ seed: "scout", dept: "dept-3" }} />
          <span className="t-body-strong flex-1 truncate text-primary">
            {
              [
                "Approve the retinol serum reorder",
                "Meridian Labs replied",
                "Weekly round-up",
                "Runway crossed 12 months",
              ][i % 4]
            }
          </span>
          <span className="text-small text-secondary">2 h</span>
        </li>
      ))}
    </ul>
  ),
  squad_pulse: () => (
    <Timeline
      className="p-panel-pad"
      now={FIXTURE_NOW}
      events={[
        {
          id: "1",
          at: new Date(FIXTURE_NOW.getTime() - 120_000),
          title: "Scout emailed Sara Lindqvist",
          tone: "info",
        },
        {
          id: "2",
          at: new Date(FIXTURE_NOW.getTime() - 900_000),
          title: "Forge merged bundle picker",
          tone: "good",
          statusWord: "Merged",
        },
        {
          id: "3",
          at: new Date(FIXTURE_NOW.getTime() - 3_600_000),
          title: "Ledger paused on approval",
          tone: "warn",
          statusWord: "Waiting",
        },
      ]}
    />
  ),
  custom_metric: ({ settings }) => (
    <MetricTile
      label={String(settings.title || "Custom metric")}
      value={128}
      format="integer"
      estimate="estimate"
      caption={String(settings.query || "")}
    />
  ),
};

const ICONS: Record<string, WidgetRegistryEntry["icon"]> = {
  journey_ribbon: LineChart,
  status_strip: Trophy,
  department_card: Users,
  inbox_preview: Inbox,
  squad_pulse: Bot,
  custom_metric: ListChecks,
};

const registry: WidgetRegistryEntry[] = DEMO_WIDGET_REGISTRY.map((e) => ({
  ...e,
  icon: ICONS[e.key] ?? e.icon,
  render: renderers[e.key] ?? e.render,
}));

const meta = {
  title: "Data/WidgetGrid",
  component: WidgetGrid,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="w-[1376px] p-gutter">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WidgetGrid>;
export default meta;

type Story = StoryObj<typeof meta>;

function Harness({
  editing,
  initial = FOUNDERS_VIEW_LAYOUT,
}: {
  editing: boolean;
  initial?: WidgetLayout;
}) {
  const [layout, setLayout] = useState<WidgetLayout>(initial);
  const saved = useMemo(
    () => JSON.stringify(layout.map((it) => [it.i, it.x, it.y, it.w, it.h])),
    [layout],
  );
  return (
    <div className="flex flex-col gap-2">
      <WidgetGrid
        layout={layout}
        registry={registry}
        onChange={setLayout}
        defaultEditing={editing}
        presets={WIDGET_PRESETS}
        defaultLayout={FOUNDERS_VIEW_LAYOUT}
      />
      <p className="truncate font-mono text-mono text-secondary">persisted: {saved}</p>
    </div>
  );
}

/** Home in Edit mode (E): dotted outlines, drag handles, resize corners, add-widget drawer, presets, reset. */
export const EditMode: Story = {
  args: { layout: [], registry: [], onChange: () => undefined },
  render: () => <Harness editing />,
};

export const FoundersView: Story = {
  args: { layout: [], registry: [], onChange: () => undefined },
  render: () => <Harness editing={false} />,
};

export const Empty: Story = {
  args: { layout: [], registry: [], onChange: () => undefined },
  render: () => <Harness editing initial={[]} />,
};
