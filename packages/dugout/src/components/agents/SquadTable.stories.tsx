import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DataTable } from "../data/DataTable";
import type { SavedView } from "../data/types";
import { mockSquadRows } from "./mock";
import { FormCells, ModelChip, RatingCell, SQUAD_VIEWS, StatusCell, ToolIcons, WageCell, squadColumns } from "./SquadCells";

const NOW = new Date("2026-10-07T09:30:00Z");

function Squad() {
  const [views, setViews] = useState<SavedView[]>(SQUAD_VIEWS);
  const [active, setActive] = useState<string | null>("general");
  const [picked, setPicked] = useState<string | null>(null);
  const rows = mockSquadRows(24);
  return (
    <div className="flex w-[1360px] flex-col gap-2">
      <DataTable
        data={rows}
        columns={squadColumns({ now: NOW, onModelClick: (r) => setPicked(r.name) })}
        getRowId={(r) => r.id}
        views={views}
        activeViewId={active}
        onViewsChange={setViews}
        onActiveViewChange={setActive}
        title="Team"
        aria-label="Team"
        height={560}
      />
      <p className="text-small text-secondary">{picked ? `Model chip clicked for ${picked}: the app opens the model picker, then ApplyScopeDialog.` : "Click a model chip to change the model."}</p>
    </div>
  );
}

const meta = {
  title: "Agents/Team table",
  component: Squad,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Squad>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The Team › Squad DataTable with the five saved views (General, Health, Tools, Cost, Performance) and the custom cells. */
export const SquadDataTable: Story = {};

export const Cells: Story = {
  render: () => {
    const rows = mockSquadRows(6);
    return (
      <div className="grid w-[720px] grid-cols-[10rem_1fr] items-center gap-x-6 gap-y-3 text-body">
        <span className="t-label">Form</span>
        <div className="flex gap-4">
          <FormCells form={["success", "success", "partial", "success", "failure"]} />
          <FormCells form={["failure", "failure", "partial"]} />
          <FormCells form={[]} />
        </div>
        <span className="t-label">Rating /20</span>
        <div className="flex gap-4">
          <RatingCell value={4.8} />
          <RatingCell value={9.2} />
          <RatingCell value={13.6} />
          <RatingCell value={18.5} />
          <RatingCell value={18.5} compact />
          <RatingCell value={0} />
        </div>
        <span className="t-label">Model</span>
        <div className="flex gap-2">
          <ModelChip model="opus" />
          <ModelChip model="sonnet" onClick={() => {}} />
          <ModelChip model="haiku" />
          <ModelChip model="opus" locked />
        </div>
        <span className="t-label">Tools</span>
        <div className="flex gap-4">
          <ToolIcons tools={rows[0]!.tools} />
          <ToolIcons tools={["github", "e2b", "gmail", "stripe", "shopify", "notion", "google_drive"]} />
          <ToolIcons tools={[]} />
        </div>
        <span className="t-label">AI cost (USD)</span>
        <div className="flex gap-4">
          <WageCell wage={{ amountMinor: 1_850_00, currency: "USD" }} />
          <WageCell wage={{ amountMinor: 92_40, currency: "USD" }} />
        </div>
        <span className="t-label">Status</span>
        <div className="flex flex-wrap gap-3">
          <StatusCell status="healthy" now={NOW} />
          <StatusCell status="degraded" now={NOW} />
          <StatusCell status="paused" now={NOW} />
          <StatusCell status="injured" expectedReturnAt="2026-10-07T12:00:00Z" now={NOW} />
          <StatusCell status="failing" now={NOW} />
        </div>
      </div>
    );
  },
};
