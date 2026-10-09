import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { LayoutGrid, List } from "lucide-react";
import { SegmentedControl } from "./SegmentedControl";

const ZOOM = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "all", label: "All time" },
] as const;

const meta = {
  title: "Foundation/SegmentedControl",
  component: SegmentedControl,
  args: { options: ZOOM as unknown as { value: string; label: string }[], defaultValue: "quarter", "aria-label": "Zoom" },
} satisfies Meta<typeof SegmentedControl>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A well; the active plate slides to the chosen option in 260 ms. ← → move between options. */
export const Zoom: Story = {};

function Controlled() {
  const [v, setV] = useState<"grid" | "list">("grid");
  return (
    <div className="flex items-center gap-4">
      <SegmentedControl
        aria-label="View"
        size="md"
        value={v}
        onValueChange={setV}
        options={[
          { value: "grid", label: "Grid", icon: LayoutGrid },
          { value: "list", label: "List", icon: List },
        ]}
      />
      <span className="font-mono text-mono text-tertiary">value: {v}</span>
    </div>
  );
}
export const WithIcons: Story = { render: () => <Controlled /> };
export const BestFitNewest: Story = {
  args: {
    "aria-label": "Sort",
    defaultValue: "best",
    options: [
      { value: "best", label: "Best fit" },
      { value: "newest", label: "Newest" },
    ],
  },
};
