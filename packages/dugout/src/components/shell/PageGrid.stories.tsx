import type { Meta, StoryObj } from "@storybook/react-vite";
import { GRID_SPANS } from "./types";
import { GridCell, PageGrid } from "./PageGrid";

const meta = {
  title: "Shell/PageGrid",
  component: PageGrid,
  parameters: { layout: "fullscreen", docs: { description: { component: "The content grid: 12 columns, 16 px gutters, 16 px outer padding. GridCell takes span 3 / 4 / 6 / 8 / 12 and an optional row span." } } },
} satisfies Meta<typeof PageGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

function Cell({ span, rows }: { span: (typeof GRID_SPANS)[number]; rows?: 1 | 2 | 3 | 4 }) {
  return (
    <GridCell span={span} rows={rows} className="surface-panel flex min-h-16 items-center justify-center font-mono text-mono text-secondary">
      span {span}
      {rows && rows > 1 ? ` · rows ${rows}` : ""}
    </GridCell>
  );
}

export const TwelveColumns: Story = {
  render: () => (
    <PageGrid>
      {GRID_SPANS.map((s) =>
        Array.from({ length: 12 / s }, (_, i) => <Cell key={`${s}-${i}`} span={s} />),
      )}
    </PageGrid>
  ),
};
export const HomeLayout: Story = {
  name: "Home layout skeleton",
  render: () => (
    <PageGrid>
      <Cell span={12} rows={3} />
      {Array.from({ length: 6 }, (_, i) => (
        <Cell key={`t${i}`} span={4} />
      ))}
      {Array.from({ length: 6 }, (_, i) => (
        <Cell key={`d${i}`} span={4} rows={2} />
      ))}
      <Cell span={8} rows={2} />
      <Cell span={4} rows={2} />
    </PageGrid>
  ),
};
