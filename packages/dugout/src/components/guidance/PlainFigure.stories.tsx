import type { Meta, StoryObj } from "@storybook/react-vite";
import { MetricTile, StatusStrip } from "../data/MetricTile";
import { GuidanceProvider } from "./GuidanceProvider";
import { PlainFigure } from "./PlainFigure";
import { FIXTURE_TERMS } from "./fixtures";

const meta = {
  title: "Guidance/PlainFigure",
  component: PlainFigure,
  parameters: {
    docs: {
      description: {
        component:
          "A figure with its plain-words line (UX plan §6.2, principle 4): “Runway 7 mo” and, under it, “How many months your cash lasts at today's spending.” The line comes from the definitions map (`metricId`) or an explicit `plain`. MetricTile takes the same two props. Guidance off: the figure alone, unwrapped.",
      },
    },
  },
  args: { metricId: "runway", children: <span className="t-display-lg text-primary">7 mo</span> },
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
        <div className="w-128 p-4">
          <Story />
        </div>
      </GuidanceProvider>
    ),
  ],
} satisfies Meta<typeof PlainFigure>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FromTheMap: Story = { name: "From the definitions map" };
export const Explicit: Story = { args: { metricId: undefined, plain: "Customers who paid at least once." } };

/** Home's tiles carry the line through MetricTile's `plain` / `metricId`. */
export const OnTiles: Story = {
  name: "On Home's tiles",
  render: () => (
    <StatusStrip
      tiles={[
        { label: "Runway", value: "7 mo", metricId: "runway", estimate: "estimate", delta: { value: -1, label: "vs last month", goodWhen: "up" } },
        { label: "MRR", value: { amountMinor: 184000, currency: "GBP" }, metricId: "mrr", delta: { value: 0.12, percent: true, label: "vs last month" } },
        { label: "Customers", value: 55, plain: "People or businesses who paid at least once.", delta: { value: 19, label: "vs last week" } },
      ]}
    />
  ),
};

/** Guidance off: the same tile, figure only. */
export const GuidanceOff: Story = {
  render: () => (
    <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
      <MetricTile label="Runway" value="7 mo" metricId="runway" estimate="estimate" className="surface-panel" />
    </GuidanceProvider>
  ),
};
