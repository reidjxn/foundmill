import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { Panel } from "../shell/Panel";
import { PageGrid } from "../shell/PageGrid";
import { DEFAULT_FIRST_WEEK_ITEMS, FirstWeekChecklist, type FirstWeekItem } from "./FirstWeekChecklist";

const items = (doneCount: number): FirstWeekItem[] => DEFAULT_FIRST_WEEK_ITEMS.map((i, n) => ({ ...i, href: `#${i.id}`, done: n < doneCount }));

const meta = {
  title: "Guidance/FirstWeekChecklist",
  component: FirstWeekChecklist,
  parameters: {
    docs: {
      description: {
        component:
          "A span-4 panel titled Your first week with the count in its meta: 34 px rows with a check (done) or a circle, the item in body text and a ghost Go link. Hide in the header dismisses it; it is pinnable through the panel menu. When every item is done it says All done once and the caller hides it. Guidance off: not rendered.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Story />
        <Panel title="Inbox" span={8}>
          <p className="text-body text-secondary">The Inbox preview sits beside it.</p>
        </Panel>
      </PageGrid>
    ),
  ],
  args: { items: items(2), onDismiss: () => undefined, menu: { onPinToHome: () => undefined } },
} satisfies Meta<typeof FirstWeekChecklist>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TwoOfSevenDone: Story = {};

export const NothingDoneYet: Story = { args: { items: items(0) } };

/** The render in which everything is done: one line, then the app hides the panel. */
export const AllDone: Story = { args: { items: items(7) } };

/** Hide removes it; the panel is gone until Settings › Preferences shows it again. */
export const Dismissable: Story = {
  render: (args) => {
    function Demo() {
      const [hidden, setHidden] = useState(false);
      if (hidden)
        return (
          <Panel title="Your first week" span={4} empty="Hidden. Settings › Preferences shows the checklist again." />
        );
      return <FirstWeekChecklist {...args} onDismiss={() => setHidden(true)} />;
    }
    return <Demo />;
  },
};

export const GuidanceOff: Story = {
  render: (args) => (
    <GuidanceProvider value={{ guidance: "off" }}>
      <FirstWeekChecklist {...args} />
      <Panel title="Guidance off" span={4}>
        <p className="text-small text-tertiary">The checklist is not rendered.</p>
      </Panel>
    </GuidanceProvider>
  ),
};
