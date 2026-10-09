import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sidebar } from "./Sidebar";
import { withSidebarKeys } from "./AppShell";
import { NORTHWIND_SIDEBAR } from "./fixtures";

const meta = {
  title: "Shell/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen", docs: { description: { component: "232 px, 64 px collapsed. Active item: 3 px brand-colour edge on bg-panel-alt. Badges: 18 px pills in the department colour. Arrow keys move, Enter opens; collapsed items show their label and chord as a tooltip. The `brand` prop adds the Foundmill wordmark as the last foot row, left-aligned with the item icons; it is drawn only while expanded and the sidebar never shows the FM monogram." } } },
  args: { items: withSidebarKeys(NORTHWIND_SIDEBAR), activeId: "d-distribution", collapsed: false, showLive: true, brand: { href: "#" }, onCollapsedChange: () => {} },
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
  const [collapsed, setCollapsed] = useState(args?.collapsed ?? false);
  const [active, setActive] = useState(args?.activeId);
  return (
    <div className="flex h-screen bg-base" style={{ "--kit-primary": "#2B6CB0" } as React.CSSProperties}>
      <Sidebar {...args} items={args?.items ?? []} collapsed={collapsed} onCollapsedChange={setCollapsed} activeId={active} onSelect={(it) => setActive(it.id)} />
      <div className="flex-1 p-4 text-small text-secondary">Active: {active} · Collapsed: {String(collapsed)}</div>
    </div>
  );
}

/** Expanded: the wordmark closes the foot, a link with the accessible name "Foundmill". */
export const Expanded: Story = { render: (args) => <Frame {...args} /> };
/** Collapsed to 64 px: icons and badges only. The wordmark does not fit, so the brand row is not drawn. */
export const Collapsed: Story = { args: { collapsed: true }, render: (args) => <Frame {...args} /> };
/** Without the `brand` prop the foot ends with the last item. */
export const WithoutBrand: Story = { args: { brand: undefined }, render: (args) => <Frame {...args} /> };
export const Personal: Story = { args: { showLive: false, activeId: "inbox" }, render: (args) => <Frame {...args} /> };
export const SideBySide: Story = {
  render: (args) => (
    <div className="flex h-screen gap-8 bg-base p-4" style={{ "--kit-primary": "#1F6F5F" } as React.CSSProperties}>
      <Sidebar {...args} collapsed={false} className="h-full" />
      <Sidebar {...args} collapsed className="h-full" />
    </div>
  ),
};
