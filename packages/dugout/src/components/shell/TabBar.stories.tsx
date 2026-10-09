import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pencil } from "lucide-react";
import { Button } from "../foundation/Button";
import { TabBar } from "./TabBar";
import { DISTRIBUTION_TABS } from "./fixtures";

const meta = {
  title: "Shell/TabBar",
  component: TabBar,
  parameters: { layout: "fullscreen", docs: { description: { component: "40 px, transparent over the lit canvas with a hairline under it. 3–7 tabs in the action style, sentence case, text-3 → text-1. The active tab's 2 px lit bar slides to the new tab in 260 ms. Counts sit in a pill (red with ink when the count needs the founder). Tabs with sub-views show a 12 px caret that opens a dropdown. Tabs never shrink below their label: what does not fit moves into a “More” menu. Arrow keys move focus, Enter opens." } } },
  args: { tabs: DISTRIBUTION_TABS, activeId: "channels", activeSubViewId: "paid" },
} satisfies Meta<typeof TabBar>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
    const [active, setActive] = useState(args?.activeId ?? "formation");
    const [sub, setSub] = useState<string | undefined>(args?.activeSubViewId);
    return (
      <TabBar
        {...args}
        tabs={args?.tabs ?? DISTRIBUTION_TABS}
        activeId={active}
        activeSubViewId={sub}
        onChange={(id, subId) => {
          setActive(id);
          setSub(subId);
        }}
        trailing={
          <Button size="sm" variant="ghost" icon={Pencil}>
            Edit layout
          </Button>
        }
      />
    );
}
export const Default: Story = { render: (args) => <Frame {...args} /> };
export const ThreeTabs: Story = { args: { tabs: DISTRIBUTION_TABS.slice(0, 3), activeId: "formation", activeSubViewId: undefined } };
export const SevenTabs: Story = {
  args: { tabs: [...DISTRIBUTION_TABS, { id: "settings", label: "Settings" }], activeId: "attribution", activeSubViewId: undefined },
};
export const WithDisabled: Story = { args: { tabs: [...DISTRIBUTION_TABS.slice(0, 4), { id: "creative", label: "Creative", disabled: true }], activeId: "leads", activeSubViewId: "new" } };
export const RespondCount: Story = {
  name: "Counts (Respond in red)",
  args: { tabs: [{ id: "all", label: "All" }, { id: "respond", label: "Respond", badge: 4, badgeTone: "bad" }, { id: "customers", label: "Customers", badge: 2 }, { id: "updates", label: "Updates" }, { id: "archive", label: "Archive" }], activeId: "all", activeSubViewId: undefined },
  render: (args) => <Frame {...args} />,
};
/** Not enough room beside the trailing slot: the last tabs move into More, which takes the active tab's name when it holds it. */
export const Overflow: Story = {
  name: "Overflow into More",
  args: { tabs: [...DISTRIBUTION_TABS, { id: "settings", label: "Settings" }], activeId: "attribution", activeSubViewId: undefined },
  render: (args) => (
    <div style={{ width: 560 }}>
      <Frame {...args} />
    </div>
  ),
};
