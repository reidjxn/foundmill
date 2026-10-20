import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CircleCheck, GitMerge, Mail, TriangleAlert } from "lucide-react";
import { Chip } from "../foundation/Chip";
import { FilterChips } from "./FilterChips";
import { KeyValueList, MiniTable, Timeline } from "./Lists";
import { Figure } from "./Figure";
import { DeltaBadge, MetricTile, StatusStrip } from "./MetricTile";
import { SavedViewSelector } from "./SavedViewSelector";
import { FIXTURE_NOW, LEAD_VIEWS } from "./fixtures";
import type { FilterChipValue, FilterField } from "./filters";
import type { SavedView } from "./types";

const SPARK = [1200, 1380, 1250, 1510, 1490, 1720, 1680, 1910, 2050, 2410];

const meta = {
  title: "Data/MetricTile",
  component: MetricTile,
  parameters: { layout: "padded" },
  args: {
    label: "Revenue (30 d)",
    value: { amountMinor: 2_410_000, currency: "EUR" },
    delta: { value: 0.12, percent: true, label: "vs prior 30 d" },
    spark: SPARK,
    provenance: { source: "Stripe · invoices paid", query: "revenue_30d", asOf: FIXTURE_NOW },
  },
} satisfies Meta<typeof MetricTile>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <div className="surface-panel w-64">
      <MetricTile {...args} />
    </div>
  ),
};

export const Forecast: Story = {
  args: {
    label: "Runway",
    value: 11.4,
    format: "decimal",
    unit: "mo",
    estimate: "forecast",
    delta: { value: -0.6, label: "vs last month" },
    spark: [13.2, 12.8, 12.4, 12.1, 11.9, 11.4],
    provenance: { source: "Finance forecast (cash basis)", note: "Assumes the current burn." },
  },
  render: (args) => (
    <div className="surface-panel w-64">
      <MetricTile {...args} />
    </div>
  ),
};

export const Loading: Story = {
  args: { loading: true },
  render: (args) => (
    <div className="surface-panel w-64">
      <MetricTile {...args} />
    </div>
  ),
};

/** Home status strip: six tiles. */
export const HomeStatusStrip: Story = {
  render: () => (
    <StatusStrip
      className="w-[1376px]"
      tiles={[
        {
          label: "Cash",
          value: { amountMinor: 18_420_000, currency: "EUR" },
          delta: { value: -0.04, percent: true, label: "30 d" },
          provenance: { source: "Tink · 2 accounts", asOf: FIXTURE_NOW },
        },
        {
          label: "Runway",
          value: 11.4,
          format: "decimal",
          unit: "mo",
          estimate: "forecast",
          delta: { value: -0.6 },
        },
        {
          label: "Revenue (30 d)",
          value: { amountMinor: 2_410_000, currency: "EUR" },
          spark: SPARK,
          delta: { value: 0.12, percent: true },
        },
        {
          label: "Customers this week",
          value: 31,
          format: "integer",
          delta: { value: 7, label: "vs last week" },
        },
        { label: "Team health", value: 4 / 6, format: "percent", caption: "4 of 6 agents healthy" },
        {
          label: "Leaderboard position",
          value: "14th",
          caption: "DTC founders · Nordics",
          delta: { value: 3, label: "places" },
        },
      ]}
    />
  ),
};

/** Inbox reading pane: up to four tiles with provenance on hover. */
export const InboxStrip: Story = {
  render: () => (
    <StatusStrip
      className="w-reading"
      tiles={[
        {
          label: "Units left",
          value: 1_240,
          format: "integer",
          provenance: { source: "Shopify inventory", asOf: FIXTURE_NOW },
        },
        {
          label: "Weeks of stock",
          value: 3.2,
          format: "decimal",
          estimate: "estimate",
          provenance: { source: "Trailing 4-week run rate" },
        },
        {
          label: "Reorder cost",
          value: { amountMinor: 1_840_000, currency: "EUR" },
          provenance: { source: "Meridian Labs quote #Q-2291" },
        },
        {
          label: "Lead time",
          value: 12,
          format: "integer",
          unit: "d",
          provenance: { source: "Supplier record" },
        },
      ]}
    />
  ),
};

export const KeyValues: Story = {
  render: () => (
    <div className="grid w-[900px] grid-cols-2 gap-gutter">
      <div className="surface-panel p-panel-pad">
        <KeyValueList
          items={[
            { label: "Lead time", value: "12 days" },
            { label: "MOQ", value: "1,000 units", numeric: true },
            { label: "Registration", value: "556677-8899", mono: true, hint: "Bolagsverket" },
            { label: "Owner", value: "Reid Jackson" },
          ]}
        />
      </div>
      <div className="surface-panel p-panel-pad">
        <KeyValueList
          layout="grid"
          items={[
            { label: "Relationship", value: "14 / 20" },
            { label: "Lead score", value: "★★★★☆" },
            { label: "Status", value: <Chip tone="good">Warm</Chip> },
            { label: "Last contact", value: "2 days ago" },
            { label: "Owner", value: "Scout" },
            { label: "Source", value: "Trade show" },
          ]}
        />
      </div>
    </div>
  ),
};

export const EventTimeline: Story = {
  render: () => (
    <div className="surface-panel w-[560px] p-panel-pad">
      <Timeline
        now={FIXTURE_NOW}
        events={[
          {
            id: "1",
            at: new Date(FIXTURE_NOW.getTime() - 120_000),
            title: "Scout emailed Sara Lindqvist",
            description: "Follow-up on the 23-store proposal.",
            icon: Mail,
            tone: "info",
            actor: { name: "Scout", agent: { seed: "scout", dept: "dept-3" }, status: "healthy" },
          },
          {
            id: "2",
            at: new Date(FIXTURE_NOW.getTime() - 900_000),
            title: "Forge merged bundle picker",
            icon: GitMerge,
            tone: "good",
            statusWord: "Merged",
            actor: { name: "Forge", agent: { seed: "forge", dept: "dept-2" }, status: "healthy" },
          },
          {
            id: "3",
            at: new Date(FIXTURE_NOW.getTime() - 3_600_000 * 5),
            title: "Ledger paused on a spend approval",
            description: "€18,400 reorder above the €5,000 threshold.",
            icon: TriangleAlert,
            tone: "warn",
            statusWord: "Waiting",
          },
          {
            id: "4",
            at: new Date(FIXTURE_NOW.getTime() - 86_400_000),
            title: "Cycle 41 completed",
            icon: CircleCheck,
            tone: "neutral",
          },
        ]}
      />
    </div>
  ),
};

export const Exhibit: Story = {
  render: () => (
    <div className="w-[560px]">
      <MiniTable
        aria-label="Reorder options"
        columns={[
          {
            id: "o",
            header: "Option",
            cell: (r: { o: string; u: number; c: string; w: number }) => r.o,
          },
          { id: "u", header: "Units", numeric: true, cell: (r) => r.u.toLocaleString("en-US") },
          { id: "c", header: "Cost", numeric: true, cell: (r) => r.c },
          { id: "w", header: "Covers", numeric: true, cell: (r) => `${r.w} wk` },
        ]}
        rows={[
          { o: "A · Reorder 2,000", u: 2000, c: "€18,400", w: 9 },
          { o: "B · Reorder 1,000", u: 1000, c: "€9,940", w: 4 },
          { o: "C · Quote first", u: 0, c: "—", w: 3 },
          { o: "D · Pause the serum", u: 0, c: "—", w: 0 },
        ]}
        maxRows={3}
        highlight={(r) => r.o.startsWith("A")}
        caption="Estimate · trailing 4-week run rate"
      />
    </div>
  ),
};

const FIELDS: FilterField[] = [
  { id: "name", label: "Name", kind: "text" },
  {
    id: "stage",
    label: "Stage",
    kind: "select",
    options: ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"].map((l) => ({
      value: l.toLowerCase(),
      label: l,
    })),
  },
  { id: "score", label: "Score", kind: "number" },
  { id: "lastContact", label: "Last contact", kind: "date" },
  { id: "replied", label: "Replied", kind: "boolean" },
];

function FiltersDemo() {
  const [chips, setChips] = useState<FilterChipValue[]>([
    { id: "a", field: "stage", op: "in", value: ["qualified", "proposal"] },
    { id: "b", field: "score", op: "gte", value: 14 },
    { id: "c", field: "lastContact", op: "after", value: "2026-09-01" },
  ]);
  return (
    <div className="flex w-[800px] flex-col gap-4">
      <FilterChips fields={FIELDS} chips={chips} onChange={setChips} />
      <FilterChips
        fields={FIELDS}
        chips={chips}
        onChange={setChips}
        readOnly
        emptyText="No filters"
      />
    </div>
  );
}

export const Filters: Story = { render: () => <FiltersDemo /> };

function SavedViewsDemo() {
  const [views, setViews] = useState<SavedView[]>(LEAD_VIEWS);
  const [active, setActive] = useState<string | null>("hot");
  const [dirty, setDirty] = useState(true);
  return (
    <div className="flex items-center gap-3">
      <SavedViewSelector
        views={views}
        activeId={active}
        onSelect={(id) => {
          setActive(id);
          setDirty(false);
        }}
        dirty={dirty}
        onSave={() => setDirty(false)}
        onSaveAs={(name) => {
          const v: SavedView = { id: `v${views.length}`, name, columns: [], sort: [], filters: [] };
          setViews([...views, v]);
          setActive(v.id);
          setDirty(false);
        }}
        onRename={(id, name) => setViews(views.map((v) => (v.id === id ? { ...v, name } : v)))}
        onDelete={(id) => setViews(views.filter((v) => v.id !== id))}
        onRevert={() => setDirty(false)}
      />
      <button type="button" className="text-small text-link" onClick={() => setDirty(true)}>
        Simulate a change
      </button>
    </div>
  );
}

export const SavedViews: Story = { render: () => <SavedViewsDemo /> };

/** Figure micro-typography (Mission "lg"): dimmed raised currency, dimmed money decimals and scale suffix, mono units. */
export const FigureTypography: Story = {
  render: () => (
    <div className="flex flex-wrap items-end gap-8">
      {["£72K", "£4,255.57", "−£15K", "94%", "20", "0.1", "SEK 1,234,567.00", "—"].map((v) => (
        <div key={v} className="flex flex-col gap-1">
          <span className="t-data">{v}</span>
          <Figure value={v} unit={v === "0.1" ? "mo" : undefined} className="t-display-lg text-primary" />
        </div>
      ))}
    </div>
  ),
};

/** Tiles in a tight strip: figures step down to fit and fall back to the compact form; captions wrap to two lines; nothing is clipped. */
export const TightStrip: Story = {
  render: () => (
    <div style={{ width: 640 }}>
      <StatusStrip
        tiles={[
          { label: "Cash in bank", value: { amountMinor: 123_456_700, currency: "SEK" }, caption: "3 connected accounts, synced 9:12 AM", spark: SPARK, provenance: { source: "Bank balances" } },
          { label: "Net burn", value: { amountMinor: -1_512_300, currency: "GBP" }, estimate: "estimate", caption: "Cash-flow positive" },
          { label: "Customers this week", value: 20, format: "integer", delta: { value: -1, label: "vs last week" }, spark: [12, 14, 13, 18, 21, 20] },
          { label: "Payback", value: 0.1, format: "decimal", unit: "mo", estimate: "estimate", caption: "141 paying customers" },
        ]}
      />
    </div>
  ),
};

/** Deltas are tone pills: one trend icon and the figure, the comparison inside. */
export const Deltas: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <DeltaBadge delta={{ value: 4.39, percent: true, label: "vs prior week" }} />
      <DeltaBadge delta={{ value: -21, label: "vs last week" }} />
      <DeltaBadge delta={{ value: 0, label: "vs last month" }} />
      <DeltaBadge delta={{ value: 1200, goodWhen: "down", label: "spend" }} />
    </div>
  ),
};
