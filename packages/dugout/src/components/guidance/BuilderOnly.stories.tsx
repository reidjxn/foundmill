import type { Meta, StoryObj } from "@storybook/react-vite";
import { RatingBar } from "../data/RatingBar";
import { RatingCell } from "../agents/SquadCells";
import { Chip } from "../foundation/Chip";
import { BuilderOnly, BuilderViewProvider } from "./BuilderView";

const meta = {
  title: "Guidance/BuilderOnly",
  component: BuilderOnly,
  parameters: {
    docs: {
      description: {
        component:
          "Builder view (docs/DESIGN.md \"Builder view\"): one account-wide switch that shows how the platform runs the team. `<BuilderOnly>` renders its children only while it is on, else its `fallback` (nothing by default); `useBuilderView()` reads the switch, false outside a provider. Off hides, never rewrites. The toolbar's \"Builder view\" toggle switches every story.",
      },
    },
  },
  args: { children: <Chip tone="neutral">48.1K tokens</Chip> },
} satisfies Meta<typeof BuilderOnly>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Follows the toolbar toggle. */
export const Default: Story = {};

/** With a fallback while off. */
export const WithFallback: Story = { args: { fallback: <span className="text-small text-secondary">Hidden while Builder view is off</span> } };

/** Off and on side by side: the engine details a founder does not see by default. */
export const OffAndOn: Story = {
  name: "Off and on",
  render: () => (
    <div className="grid w-[640px] grid-cols-2 gap-gutter">
      {[false, true].map((on) => (
        <BuilderViewProvider key={String(on)} on={on}>
          <div className="flex flex-col gap-2 rounded-md border border-line p-3">
            <span className="t-data">{on ? "Builder view on" : "Builder view off"}</span>
            <span className="flex items-center gap-2 text-small text-secondary">
              Cost $0.42
              <BuilderOnly>
                <span>· 48.1K tokens · ETA 4m</span>
              </BuilderOnly>
            </span>
            <RatingCell value={14.6} />
            <RatingBar value={14} name="Planning" />
          </div>
        </BuilderViewProvider>
      ))}
    </div>
  ),
};
