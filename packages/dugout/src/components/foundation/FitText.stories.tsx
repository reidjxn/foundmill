import type { ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { FitText } from "./FitText";

const meta = {
  title: "Foundation/FitText",
  component: FitText,
  args: { children: "Sourcing and Manufacturing Specialist" },
} satisfies Meta<typeof FitText>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Resize the slots (drag the corner): the text steps down to its floor, then truncates with a tooltip. */
function Slot({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 font-mono text-mono text-tertiary">{width} px</span>
      <div className="resize-x overflow-hidden border border-dashed border-line px-2 py-1" style={{ width }}>
        {children}
      </div>
    </div>
  );
}

export const Names: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      {[300, 230, 200, 160, 110].map((w) => (
        <Slot key={w} width={w}>
          <FitText>Sourcing and Manufacturing Specialist</FitText>
        </Slot>
      ))}
    </div>
  ),
};

/** Titles in display type step down to 75 % (20 px → 15 px) before truncating. */
export const ScreenTitle: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {[260, 200, 150].map((w) => (
        <Slot key={w} width={w}>
          <h1 className="t-display-md">
            <FitText>Settings · Departments</FitText>
          </h1>
        </Slot>
      ))}
    </div>
  ),
};

/** Ids and emails keep both ends: "middle" truncation. */
export const Middle: Story = {
  render: () => (
    <div className="flex flex-col gap-2 font-mono text-mono">
      {[260, 140, 100].map((w) => (
        <Slot key={w} width={w}>
          <FitText truncate="middle">inv_8f2c41d9a7e34b12_2041</FitText>
        </Slot>
      ))}
    </div>
  ),
};

/** Numbers never truncate: at the floor they show a compact fallback instead. */
export const Numbers: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      {[200, 140, 96].map((w) => (
        <Slot key={w} width={w}>
          <span className="t-display-lg">
            <FitText truncate={false} fallback="SEK 1.2m">
              SEK 1,234,567.00
            </FitText>
          </span>
        </Slot>
      ))}
    </div>
  ),
};

/** Two lines first (decision options), then shrink, then clamp. */
export const TwoLines: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-body">
      {[240, 160, 120].map((w) => (
        <Slot key={w} width={w}>
          <FitText lines={2}>Order two SKUs now, the serum after its stability review</FitText>
        </Slot>
      ))}
    </div>
  ),
};
