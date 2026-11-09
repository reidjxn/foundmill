import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Panel } from "../shell/Panel";
import { PageGrid } from "../shell/PageGrid";
import { Explainer, type ExplainerProps } from "./Explainer";
import { GuidanceProvider } from "./GuidanceProvider";

const meta = {
  title: "Guidance/Explainer",
  component: Explainer,
  parameters: {
    docs: {
      description: {
        component:
          "The per-screen explanation. A screen renders it where it always did and it draws nothing in place: it registers its three lines with the page (`PageExplainProvider`, mounted by the shell), and the shell's one “Explain this page” button shows them. Last mounted wins. Outside a provider, as in these stories, it falls back to the same button and panel in place. Guidance off: not rendered.",
      },
    },
  },
  args: {
    screenId: "home",
    purpose: "Your business at a glance: what the team did last cycle and what it needs from you.",
    action: "Read the notes in the Inbox, then press Continue to run the next cycle.",
    watchFor: "The runway tile turning amber: under 9 months of cash left.",
  },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Panel title="Home" span={12}>
          <Story />
          <p className="mt-3 text-body text-secondary">The panel's own content starts with itself; there is no banner above it.</p>
        </Panel>
      </PageGrid>
    ),
  ],
} satisfies Meta<typeof Explainer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Inline fallback: the button, with the unread dot until it is opened. */
export const Default: Story = {};
export const WithExample: Story = { name: "With Show me an example", args: { onExample: () => {} } };

/** Already seen: no unread dot. */
export const Seen: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ explainersSeen: { home: true } }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};

function Remembered(args: ExplainerProps) {
  const [seen, setSeen] = useState<Record<string, true>>({});
  return (
    <GuidanceProvider value={{ explainersSeen: seen }} actions={{ markExplainerSeen: (id) => setSeen((s) => ({ ...s, [id]: true })) }}>
      <Explainer {...args} />
      <p className="mt-3 text-small text-tertiary">explainers_seen: {JSON.stringify(seen)}</p>
    </GuidanceProvider>
  );
}

/** Wired to a provider: opening the panel records the screen the way the account preference does. */
export const Stateful: Story = {
  name: "Opened, remembered",
  render: (args) => <Remembered {...args} />,
};

/** Guidance off: nothing renders. */
export const GuidanceOff: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off" }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};
