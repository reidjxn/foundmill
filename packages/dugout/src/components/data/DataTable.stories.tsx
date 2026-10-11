import type { Meta, StoryObj } from "@storybook/react-vite";
import { useMemo, useState } from "react";
import { Archive, Bot, ExternalLink, ListPlus, Mail } from "lucide-react";
import { formatDate, formatMoney } from "../../lib/format";
import { Chip } from "../foundation/Chip";
import { StatusPill, type StatusTone } from "../foundation/StatusPill";
import { DataTable, type DataTableColumn } from "./DataTable";
import { EntityLink } from "./EntityLink";
import { RatingFigure } from "./RatingBar";
import {
  generateLeads,
  LEAD_STAGE_LABELS,
  LEAD_VIEWS,
  type LeadRow,
  type LeadStage,
} from "./fixtures";
import type { SavedView } from "./types";

const STAGE_TONE: Record<LeadStage, StatusTone> = {
  new: "info",
  contacted: "neutral",
  qualified: "warn",
  proposal: "warn",
  won: "good",
  lost: "bad",
};

const columns: DataTableColumn<LeadRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    size: 200,
    cell: ({ row }) => (
      <EntityLink
        entity={{ id: row.original.id, kind: "person", name: row.original.name }}
        hoverCard={false}
        contextMenu={false}
      />
    ),
  },
  { accessorKey: "company", header: "Company", size: 190 },
  {
    accessorKey: "stage",
    header: "Stage",
    size: 130,
    meta: {
      filter: "select",
      filterOptions: Object.entries(LEAD_STAGE_LABELS).map(([value, label]) => ({ value, label })),
    },
    cell: ({ getValue }) => {
      const stage = getValue() as LeadStage;
      return <StatusPill tone={STAGE_TONE[stage]}>{LEAD_STAGE_LABELS[stage]}</StatusPill>;
    },
  },
  {
    accessorKey: "owner",
    header: "Owner",
    size: 150,
    meta: {
      filter: "select",
      filterOptions: ["Scout", "Mailer", "Signal", "Reid Jackson"].map((v) => ({
        value: v,
        label: v,
      })),
    },
    cell: ({ row }) => (
      <EntityLink
        entity={{
          id: `owner-${row.original.owner}`,
          kind: row.original.ownerKind,
          name: row.original.owner,
        }}
        hoverCard={false}
        contextMenu={false}
      />
    ),
  },
  {
    accessorKey: "channel",
    header: "Channel",
    size: 150,
    cell: ({ getValue }) => <Chip tone="neutral">{String(getValue()).replace(/_/g, " ")}</Chip>,
  },
  {
    accessorKey: "score",
    header: "Score",
    size: 80,
    meta: { numeric: true },
    cell: ({ getValue }) => <RatingFigure value={getValue() as number} className="text-body" />,
  },
  {
    accessorKey: "value",
    header: "Value",
    size: 120,
    meta: { numeric: true, csv: (r) => r.value.amountMinor / 100 },
    sortingFn: (a, b) => a.original.value.amountMinor - b.original.value.amountMinor,
    filterFn: (row, _id, v: { chips: { op: string; value?: unknown }[] }) =>
      v.chips.every((c) =>
        c.op === "gte"
          ? row.original.value.amountMinor / 100 >= Number(c.value)
          : c.op === "lte"
            ? row.original.value.amountMinor / 100 <= Number(c.value)
            : true,
      ),
    cell: ({ row }) => formatMoney(row.original.value),
  },
  {
    accessorKey: "lastContact",
    header: "Last contact",
    size: 130,
    meta: { filter: "date" },
    cell: ({ getValue }) => formatDate(getValue() as Date),
  },
  {
    accessorKey: "country",
    header: "Country",
    size: 90,
    meta: {
      filter: "select",
      filterOptions: ["SE", "NO", "DK", "FI", "DE", "NL", "GB"].map((v) => ({
        value: v,
        label: v,
      })),
    },
  },
  {
    accessorKey: "email",
    header: "Email",
    size: 240,
    meta: { className: "font-mono text-mono text-secondary" },
  },
];

const meta = {
  title: "Data/DataTable",
  component: DataTable,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="p-gutter">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataTable>;
export default meta;

type Story = StoryObj<typeof meta>;

function LeadsTable({ count, height = 560 }: { count: number; height?: number }) {
  const data = useMemo(() => generateLeads(count), [count]);
  const [views, setViews] = useState<SavedView[]>(LEAD_VIEWS);
  const [active, setActive] = useState<string | null>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 4));
  return (
    <div className="flex flex-col gap-2">
      <DataTable<LeadRow>
        aria-label="Leads"
        data={data}
        columns={columns}
        views={views}
        activeViewId={active}
        onActiveViewChange={setActive}
        onViewsChange={setViews}
        selectable
        selectedIds={selected}
        onSelectionChange={setSelected}
        height={height}
        exportFileName="leads"
        onRowOpen={(row) => note(`Open ${row.name}`)}
        rowActions={(row) => [
          {
            id: "message",
            label: "Message",
            icon: Mail,
            shortcut: "M",
            onSelect: (r) => note(`Message ${r.name}`),
          },
          {
            id: "assign",
            label: "Assign agent",
            icon: Bot,
            onSelect: (r) => note(`Assign agent to ${r.name}`),
          },
          {
            id: "list",
            label: "Add to list",
            icon: ListPlus,
            onSelect: (r) => note(`Add ${r.name} to a list`),
          },
          {
            id: "open",
            label: "Open profile",
            icon: ExternalLink,
            separatorBefore: true,
            onSelect: (r) => note(`Open ${r.name}`),
          },
          {
            id: "archive",
            label: "Archive lead",
            icon: Archive,
            variant: "danger",
            separatorBefore: true,
            disabled: row.stage === "won",
            onSelect: (r) => note(`Archive ${r.name}`),
          },
        ]}
      />
      <p className="text-small text-secondary" aria-live="polite">
        {log.length === 0
          ? "Right-click a row for verbs; Enter or double-click opens; Shift+click a header for a secondary sort."
          : log.join(" · ")}
      </p>
    </div>
  );
}

/** 5,000 generated leads, three saved views, filter chips, a right-click menu and CSV export. */
export const FiveThousandLeads: Story = {
  args: { data: [], columns: [] },
  render: () => <LeadsTable count={5000} />,
};

export const SmallWithoutViews: Story = {
  args: { data: [], columns: [] },
  render: () => (
    <DataTable
      title="Recent leads"
      data={generateLeads(12, "small")}
      columns={columns.slice(0, 7)}
      height={380}
    />
  ),
};

export const ComfortableDensity: Story = {
  args: { data: [], columns: [] },
  render: () => (
    <DataTable
      title="Team"
      data={generateLeads(30, "squad")}
      columns={columns.slice(0, 7)}
      defaultDensity="comfortable"
      height={400}
      selectable
    />
  ),
};

export const States: Story = {
  args: { data: [], columns: [] },
  render: () => (
    <div className="grid grid-cols-3 gap-gutter">
      <DataTable title="Loading" data={[]} columns={columns.slice(0, 4)} loading height={240} />
      <DataTable
        title="Empty"
        data={[]}
        columns={columns.slice(0, 4)}
        empty="Leads appear here once a channel is live. Enable one in Distribution."
        height={240}
      />
      <DataTable
        title="Error"
        data={[]}
        columns={columns.slice(0, 4)}
        error="The leads query timed out."
        onRetry={() => undefined}
        height={240}
      />
    </div>
  ),
};

interface UsageRow {
  id: string;
  item: string;
  quantity: number;
  amount: number;
  note: string | null;
}
const usageColumns: DataTableColumn<UsageRow>[] = [
  { id: "item", accessorKey: "item", header: "Item", size: 220 },
  { id: "quantity", accessorKey: "quantity", header: "Quantity", size: 64, meta: { numeric: true }, cell: ({ getValue }) => (getValue() as number).toLocaleString("en-US") },
  { id: "amount", accessorKey: "amount", header: "Amount", size: 64, meta: { numeric: true }, cell: ({ getValue }) => formatMoney({ amountMinor: getValue() as number, currency: "GBP" }) },
  { id: "note", accessorKey: "note", header: "Note", size: 160 },
];
const usage: UsageRow[] = [
  { id: "1", item: "Model tokens", quantity: 8_875_803, amount: 11_941, note: null },
  { id: "2", item: "Sandbox minutes", quantity: 12_480, amount: 2_496, note: null },
  { id: "3", item: "Tool calls", quantity: 1_204_118, amount: 120_412_33, note: null },
];

/** Numbers never truncate: numeric columns narrower than their values grow to fit them; an all-empty column is hidden. */
export const NumbersNeverTruncate: Story = {
  args: { data: [], columns: [] },
  render: () => <DataTable title="Usage this month" data={usage} columns={usageColumns} hideEmptyColumns height={200} footer={null} />,
};

const growColumns: DataTableColumn<LeadRow>[] = [
  { accessorKey: "name", header: "Name", size: 150 },
  { accessorKey: "company", header: "Company", size: 140, meta: { grow: 1 } },
  {
    accessorKey: "stage",
    header: "Stage",
    // Narrower than its widest pill on purpose: a chip-only column widens to fit, never cutting a pill.
    size: 60,
    cell: ({ getValue }) => {
      const stage = getValue() as LeadStage;
      return <StatusPill tone={STAGE_TONE[stage]}>{LEAD_STAGE_LABELS[stage]}</StatusPill>;
    },
  },
  { accessorKey: "email", header: "Email", size: 180, meta: { grow: 2 } },
  { accessorKey: "score", header: "Score", size: 56, meta: { numeric: true } },
];

/**
 * Spare width by weight (`meta.grow`): Email takes two shares and Company one, in the header and the body alike, so the
 * numbers stay together on the right. The Stage column fits its pills. The screen filters with its own search, so the
 * table's Filter button is hidden (`hideFilter`).
 */
export const GrowingColumns: Story = {
  args: { data: [], columns: [] },
  render: () => (
    <div className="flex flex-col gap-gutter">
      <DataTable title="People" data={generateLeads(8, "grow")} columns={growColumns} height={260} hideFilter />
      <DataTable title="People" data={generateLeads(8, "grow")} columns={growColumns} height={260} filterLabel="Filter rows" />
    </div>
  ),
};
