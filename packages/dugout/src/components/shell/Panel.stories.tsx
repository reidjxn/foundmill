import type { Meta, StoryObj } from "@storybook/react-vite";
import { Download, Megaphone } from "lucide-react";
import { ProvenanceChip } from "../foundation/Chip";
import { Sparkline } from "../foundation/Sparkline";
import { StatusPill } from "../foundation/StatusPill";
import { GridCell, PageGrid } from "./PageGrid";
import { Panel } from "./Panel";

const meta = {
  title: "Shell/Panel",
  component: Panel,
  parameters: { docs: { description: { component: "A machined plate: surface 1, 10 px radius, a 1 px gradient edge that catches light at the top left and bottom right, a faint top light, elev-1; optionally lit from its corner by a department color or the brand (`glow`). The 40 px header sits on the panel's own surface — no band: the title in Inter 600 sentence case, optional mono meta, the actions and a ghost “…” menu (swap content, settings, Pin to Home), and a rule fading out under it. Header actions wrap under the title before they squeeze it. Loading shows a skeleton, never a spinner; empty and error states replace the body." } } },
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
export const WithMeta: Story = { args: { title: "Journey", meta: "Aug 6 – Nov 8, 2026", actions: <ProvenanceChip kind="forecast" />, span: 12 } };
/** A help tip after the meta (Guidance/InfoTip): one sentence about the panel, hidden when guidance is off. */
export const WithHelp: Story = { args: { title: "Cash and runway", meta: "Last 30 days", help: "How long the money lasts at today's spending.", helpLearn: "finance/runway", span: 6 } };
export const DepartmentGlow: Story = {
  name: "Department and brand light",
  render: () => (
    <>
      <Panel title="Product" glow="dept-1" span={4} actions={<StatusPill tone="good">Healthy</StatusPill>}>
        <p className="text-body text-secondary">The roadmap's next release lands on Oct 21.</p>
      </Panel>
      <Panel title="Formulation Lab" glow="dept-2" span={4} actions={<StatusPill tone="warn">Degraded</StatusPill>}>
        <p className="text-body text-secondary">Stability data for the serum reformulation is in review.</p>
      </Panel>
      <Panel title="Journey" glow="brand" meta="Last 90 days" span={4}>
        <p className="text-body text-secondary">Brand-lit: the Journey and the Ideation brief.</p>
      </Panel>
    </>
  ),
};
/** A narrow panel with a long title and header actions: the actions wrap under the title, the title is never cut. */
export const LongTitleWithActions: Story = {
  args: { title: "Version history of the specification", span: 3, actions: <StatusPill tone="info">Live</StatusPill> },
};
