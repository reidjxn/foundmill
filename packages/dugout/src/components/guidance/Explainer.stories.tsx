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
          "The per-screen intro (UX plan §6.2): a surface-2 strip inside the first panel's body, never floating, never pushing the 40 px header. A BookOpen in kit-lift, three data labels with one body line each, a ghost “Got it” and an optional “Show me an example”. After “Got it” it collapses to one line with a chevron and the screen is remembered in `explainers_seen`. Guidance off: not rendered.",
      },
    },
  },
  args: {
    screenId: "home",
    purpose: "Your business at a glance: what the team did last cycle and what it needs from you.",
    action: "Read the notes in the Inbox, then press Continue to run the next cycle.",
    watchFor: "The runway tile turning amber: the team will slow its spending until you decide.",
  },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Panel title="Home" span={12}>
          <Story />
          <p className="mt-3 text-body text-secondary">The panel's own content follows the strip.</p>
        </Panel>
      </PageGrid>
    ),
  ],
} satisfies Meta<typeof Explainer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const WithExample: Story = { name: "With Show me an example", args: { onExample: () => {} } };

/** Collapsed: the screen was already seen. The chevron opens it again. */
export const Collapsed: Story = {
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

/** Wired to a provider: “Got it” records the screen the way the account preference does. */
export const Stateful: Story = {
  name: "Got it, remembered",
  render: (args) => <Remembered {...args} />,
};

/** Guidance off: nothing renders, and the panel body starts with its own content. */
export const GuidanceOff: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off" }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};
