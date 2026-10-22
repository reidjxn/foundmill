import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "../foundation/Label";
import { Input } from "../foundation/Input";
import { Panel } from "../shell/Panel";
import { GuidanceProvider } from "./GuidanceProvider";
import { InfoTip } from "./InfoTip";
import { LearnLinkProvider } from "./LearnLink";

const meta = {
  title: "Guidance/InfoTip",
  component: InfoTip,
  parameters: {
    docs: {
      description: {
        component:
          "A 14 px Info button in text-3 on a 24 px target, named “About <label>”: a Tooltip for one sentence, or the definition card when there is somewhere to go (`learn`). `kind=\"why\"` swaps the icon for a question mark. It sits after a Panel's meta (`help`), beside a Field's label (`help`), and wherever a sentence helps. Hidden when guidance is off, unless `always`.",
      },
    },
  },
  args: { label: "Cash and runway", children: "How long the money lasts at today's spending." },
  decorators: [
    (Story) => (
      <LearnLinkProvider resolve={(learn) => `#${learn}`}>
        <div className="flex items-center gap-2 p-4 text-body">
          <span>Cash and runway</span>
          <Story />
        </div>
      </LearnLinkProvider>
    ),
  ],
} satisfies Meta<typeof InfoTip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Tooltip: Story = {};
export const WithLearnMore: Story = { name: "With Learn more (a definition card)", args: { learn: "finance/runway" } };
export const Why: Story = { args: { kind: "why", label: "Experience", children: "We ask so guidance can start quieter for founders who have done this before." } };

/** On a Panel header (after the meta) and beside a Field's label. */
export const InPlace: Story = {
  name: "In a panel header and a field",
  decorators: [(Story) => <div className="w-128"><Story /></div>],
  render: () => (
    <div className="flex flex-col gap-4">
      <Panel title="Cash and runway" meta="Last 30 days" help="How long the money lasts at today's spending." helpLearn="finance/runway">
        <p className="text-body text-secondary">Body.</p>
      </Panel>
      <Field htmlFor="biz" label="Business name" help="The name customers see; you can rename it later." hint="Shown on invoices.">
        <Input id="biz" defaultValue="Northwind Skincare" />
      </Field>
    </div>
  ),
};

/** Guidance off: the tip is gone; `always` keeps one for information. */
export const GuidanceOff: Story = {
  render: () => (
    <GuidanceProvider value={{ guidance: "off" }}>
      <span className="text-secondary">(hidden)</span>
      <InfoTip label="Cash and runway">How long the money lasts at today's spending.</InfoTip>
      <span className="ml-4 text-secondary">always:</span>
      <InfoTip label="Estimate" always>
        Worked out, not measured.
      </InfoTip>
    </GuidanceProvider>
  ),
};
