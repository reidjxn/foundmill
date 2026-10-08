import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, Megaphone } from "lucide-react";
import { Sparkline } from "../foundation/Sparkline";
import { StatusPill } from "../foundation/StatusPill";
import { GridCell, PageGrid } from "./PageGrid";
import { Panel } from "./Panel";

const meta = {
  title: "Shell/Panel",
  component: Panel,
  parameters: { docs: { description: { component: "bg-panel, hairline, 4 px radius, inner highlight, no shadow. 32 px raised header with the title in label style and a caret menu (swap content, settings, Pin to Home). Loading shows a skeleton, never a spinner; empty and error states replace the body." } } },
  args: { title: "Channel performance", span: 6, children: <p className="text-body">Body content.</p>, menu: { onSwap: () => {}, onSettings: () => {}, onPinToHome: () => {} } },
  argTypes: { span: { control: "select", options: [3, 4, 6, 8, 12] } },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Story />
      </PageGrid>
    ),
  ],
} satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {
  args: {
    actions: <StatusPill tone="good">Live</StatusPill>,
    footer: "Updated 2 min ago · 6 channels",
    children: (
      <div className="flex items-end justify-between">
        <span className="t-display-lg">€38</span>
        <Sparkline data={[52, 48, 46, 44, 41, 40, 38]} width={160} height={40} className="text-dept-3" />
      </div>
    ),
  },
};
export const Loading: Story = { args: { loading: true } };
export const Empty: Story = { args: { empty: "Leads appear here once a channel is live. Enable one in Distribution › Channels." } };
export const EmptyWithAction: Story = { args: { empty: { icon: Megaphone, title: "No campaigns yet", children: "Scout drafts the first campaign when you enable a channel.", action: { label: "Enable a channel" } } } };
export const ErrorState: Story = { args: { error: "The channel metrics query timed out.", onRetry: () => {} } };
export const Pinned: Story = { args: { menu: { onSwap: () => {}, onSettings: () => {}, onPinToHome: () => {}, pinned: true, items: [{ id: "csv", label: "Export CSV", icon: Download, onSelect: () => {} }] } } };
export const Spans: Story = {
  render: () => (
    <>
      {([3, 3, 3, 3, 4, 4, 4, 6, 6, 8, 4, 12] as const).map((s, i) => (
        <Panel key={i} title={`Span ${s}`} span={s}>
          <p className="text-small text-secondary">{s} of 12 columns</p>
        </Panel>
      ))}
      <GridCell span={12} className="text-small text-secondary">
        Panels snap to 3, 4, 6, 8 or 12 columns (BUILD §5.3).
      </GridCell>
    </>
  ),
};
