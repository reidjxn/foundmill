import type { Meta, StoryObj } from "@storybook/react-vite";
import { createRng } from "../../../lib/seed";
import { formatMoney } from "../../../lib/format";
import { AreaChart } from "./AreaChart";
import { BarChart } from "./BarChart";
import { FunnelChart } from "./FunnelChart";
import { Heatmap } from "./Heatmap";
import { LineChart } from "./LineChart";

const rng = createRng("charts");
const day = (i: number) => new Date(Date.UTC(2026, 6, 1 + i));
const revenue = Array.from({ length: 98 }, (_, i) => ({ x: day(i), y: 140000 + i * 1800 + rng.range(-20000, 20000) }));
const last = revenue[revenue.length - 1]!;
const forecast = Array.from({ length: 30 }, (_, i) => ({ x: day(97 + i), y: last.y * (1 + 0.004 * i) }));
const money = (v: number) => formatMoney({ amountMinor: Math.round(v), currency: "EUR" }, { compact: true });

const meta = {
  title: "Journey/Charts",
  parameters: { docs: { description: { component: "The chart set used by Inbox exhibits and Finance (BUILD §11.3, §11.8): visx, tokens only, hover tooltips, legends, and Forecast / Estimate labelling on every non-real value." } } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface-panel flex flex-col overflow-hidden">
      <header className="flex h-panel-header items-center px-panel-pad rule-fade">
        <h2 className="t-title text-primary">{title}</h2>
      </header>
      <div className="p-panel-pad">{children}</div>
    </section>
  );
}

export const Line: Story = {
  render: () => (
    <div className="w-[720px]">
      <Tile title="Revenue · 7-day mean, with forecast">
        <LineChart label="Revenue with forecast" height={200} yFormat={money} markX={day(97)} markLabel="Today" provenance="forecast" series={[{ id: "rev", label: "Revenue", tone: "kit", data: revenue, area: true }, { id: "fc", label: "Base case", tone: "kit", data: [last, ...forecast], dashed: true }]} />
      </Tile>
    </div>
  ),
};

export const Area: Story = {
  render: () => (
    <div className="w-[720px]">
      <Tile title="Agent hours by department · stacked">
        <AreaChart
          label="Agent hours by department"
          height={200}
          stacked
          series={[
            { id: "lab", label: "Formulation Lab", tone: "dept-2", data: Array.from({ length: 30 }, (_, i) => ({ x: day(i), y: 6 + rng.range(-1, 2) })) },
            { id: "dist", label: "Distribution", tone: "dept-3", data: Array.from({ length: 30 }, (_, i) => ({ x: day(i), y: 4 + rng.range(-1, 2) })) },
            { id: "prod", label: "Product", tone: "dept-1", data: Array.from({ length: 30 }, (_, i) => ({ x: day(i), y: 2 + rng.range(-0.5, 1) })) },
          ]}
        />
      </Tile>
    </div>
  ),
};

export const Bars: Story = {
  render: () => (
    <div className="grid w-[960px] grid-cols-2 gap-gutter">
      <Tile title="Net burn by month">
        <BarChart label="Net burn by month" height={200} format={money} showValues data={[{ label: "May", value: -1840000 }, { label: "Jun", value: -1720000 }, { label: "Jul", value: -1610000 }, { label: "Aug", value: -1480000 }, { label: "Sep", value: -1390000 }, { label: "Oct", value: -1300000, provenance: "forecast" }]} provenance="forecast" />
      </Tile>
      <Tile title="Customers by channel · last 90 days">
        <BarChart label="Customers by channel" height={200} horizontal showValues tone="dept-3" data={[{ label: "Paid ads", value: 41 }, { label: "Email", value: 28 }, { label: "SEO", value: 22 }, { label: "Influencer", value: 14 }, { label: "Direct mail", value: 6 }]} />
      </Tile>
    </div>
  ),
};

export const Funnel: Story = {
  render: () => (
    <div className="flex w-[720px] flex-col gap-gutter">
      <Tile title="Acquisition funnel · 30 days">
        <FunnelChart label="Acquisition funnel" stages={[{ label: "Visits", value: 12480 }, { label: "Signups", value: 842 }, { label: "Activated", value: 411 }, { label: "Paid", value: 96 }]} />
      </Tile>
      {/* A tiny step reads "<1%", never "0%"; a count that does not fit its hairline bar sits beside it. */}
      <Tile title="Touch funnel · 35 days">
        <FunnelChart label="Touch funnel" stages={[{ label: "Impressions", value: 2_900_000 }, { label: "Signups", value: 115 }, { label: "Activations", value: 72 }, { label: "Customers", value: 27 }]} provenance="estimate" />
      </Tile>
    </div>
  ),
};

export const HeatmapStory: Story = {
  name: "Heatmap",
  render: () => (
    <div className="w-[720px]">
      <Tile title="Email opens by weekday × hour">
        <Heatmap label="Email opens by weekday and hour" rows={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} cols={Array.from({ length: 24 }, (_, h) => String(h))} values={Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (h >= 7 && h <= 20 ? rng.range(0, d >= 5 ? 20 : 60) : rng.range(0, 6))))} tone="dept-3" format={(v) => `${Math.round(v)} opens`} />
      </Tile>
    </div>
  ),
};

/** Axes that never clip: margins sized to the widest label ("−£5K"), a real minus, month labels thinned when they would touch, integer ticks for counts, value labels on every bar or none (only when all fit), with room under zero for the negative ones. */
export const TightAxes: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-gutter" style={{ width: 960 }}>
      <Tile title="Net cash change by month">
        <BarChart
          label="Net cash change by month"
          height={200}
          format={(v) => formatMoney({ amountMinor: Math.round(v), currency: "GBP" }, { compact: true })}
          showValues
          provenance="estimate"
          data={["Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026", "Sep 2026"].map((label, i) => ({ label, value: [-398300, 144800, -501300, 2100000, 1000000, 1500000][i]! }))}
        />
      </Tile>
      <Tile title="Signups per week">
        <LineChart label="Signups per week" height={200} series={[{ id: "s", label: "Signups", tone: "info", data: Array.from({ length: 12 }, (_, i) => ({ x: i + 1, y: [0, 1, 1, 2, 1, 3, 2, 2, 4, 3, 5, 4][i]! })), area: true }]} xType="linear" yFormat={(v) => String(v)} />
      </Tile>
    </div>
  ),
};
