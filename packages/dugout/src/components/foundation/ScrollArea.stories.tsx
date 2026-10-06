import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "./ScrollArea";

const meta = { title: "Foundation/ScrollArea", component: ScrollArea } satisfies Meta<typeof ScrollArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Log: Story = {
  render: () => (
    <ScrollArea className="h-48 w-96 rounded-panel border border-subtle bg-ink">
      <pre className="p-3 font-mono text-mono text-secondary">
        {Array.from({ length: 40 }, (_, i) => `[${String(i).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}] tool_call read_file src/pricing.ts`).join("\n")}
      </pre>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea orientation="horizontal" className="w-96 rounded-panel border border-subtle bg-panel">
      <div className="flex gap-2 p-3">
        {Array.from({ length: 16 }, (_, i) => (
          <div key={i} className="flex h-16 w-24 shrink-0 items-center justify-center rounded-panel bg-panel-alt text-small text-secondary">
            Tile {i + 1}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
};
