import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "./Checkbox";

const meta = {
  title: "Foundation/Checkbox",
  component: Checkbox,
  args: { "aria-label": "Select row" },
} satisfies Meta<typeof Checkbox>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { defaultChecked: true } };
export const Indeterminate: Story = { args: { checked: "indeterminate" } };
export const Disabled: Story = { args: { disabled: true, defaultChecked: true } };

function Group() {
  const [rows, setRows] = useState([true, false, true]);
  const all = rows.every(Boolean) ? true : rows.some(Boolean) ? "indeterminate" : false;
  return (
    <div className="flex w-64 flex-col gap-2 text-body">
      <label className="flex items-center gap-2">
        <Checkbox checked={all} onCheckedChange={(c) => setRows(rows.map(() => c === true))} aria-label="Select all" />
        <span className="t-label normal-case tracking-normal">Select all</span>
      </label>
      {["Pricing page rewrite", "SEO comparison article", "Bank feed connector"].map((t, i) => (
        <label key={t} className="flex items-center gap-2 pl-4">
          <Checkbox checked={rows[i]} onCheckedChange={(c) => setRows(rows.map((r, j) => (j === i ? c === true : r)))} />
          {t}
        </label>
      ))}
    </div>
  );
}

export const WithSelectAll: Story = { render: () => <Group /> };
