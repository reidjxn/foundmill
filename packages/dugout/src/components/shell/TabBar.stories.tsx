import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Pencil } from "lucide-react";
import { Button } from "../foundation/Button";
import { TabBar } from "./TabBar";
import { DISTRIBUTION_TABS } from "./fixtures";

const meta = {
  title: "Shell/TabBar",
  component: TabBar,
  parameters: { layout: "fullscreen", docs: { description: { component: "40 px, bg-panel. 3–7 tabs in tab style; the active tab has a 2 px text-primary underline; tabs with sub-views show a 12 px caret that opens a dropdown. Arrow keys move focus, Enter opens." } } },
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
