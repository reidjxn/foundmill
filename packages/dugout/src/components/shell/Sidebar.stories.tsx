import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sidebar } from "./Sidebar";
import { withSidebarKeys } from "./AppShell";
import { kitStyle } from "./KitBar";
import { LEDGERLY_KIT, NORTHWIND_KIT, NORTHWIND_SIDEBAR } from "./fixtures";

const meta = {
  title: "Shell/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen", docs: { description: { component: "232 px on the rail (64 px collapsed), its inner hairline catching light at the top. Items are 32 px, 10 px in from the edges, sentence case: a 16 px icon in text-3 (department icons carry a small dot in their color) and an action-style label; hover adds a 3.5% plate. Active: a brand plate (primary 30% → 7%) with a kit-lift ring and icon, and a lit 3 px edge with its glow at the rail's edge. Badges are 18 px glowing pills in the department color (red for the Inbox). Groups are separated by fading hairlines. A long founder-defined label wraps to two lines and steps down to fit — never silently clipped. Arrow keys move, Enter opens; collapsed items show their label and chord as a tooltip. The `brand` prop adds the Foundmill wordmark as the last foot row, aligned with the item icons; it is drawn only while expanded and the sidebar never shows the FM monogram." } } },
  args: { items: withSidebarKeys(NORTHWIND_SIDEBAR), activeId: "d-distribution", collapsed: false, showLive: true, brand: { href: "#" }, onCollapsedChange: () => {} },
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
  const [collapsed, setCollapsed] = useState(args?.collapsed ?? false);
  const [active, setActive] = useState(args?.activeId);
  return (
    <div className="flex h-screen bg-canvas" style={kitStyle(NORTHWIND_KIT)}>
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
    <div className="flex h-screen gap-8 bg-canvas p-4" style={kitStyle(LEDGERLY_KIT)}>
      <Sidebar {...args} collapsed={false} className="h-full" />
      <Sidebar {...args} collapsed className="h-full" />
    </div>
  ),
};
/** A founder may name a department up to 80 characters: the label wraps to two lines and steps down; it is never cut silently. */
export const LongDepartmentNames: Story = {
  args: {
    items: withSidebarKeys([
      ...NORTHWIND_SIDEBAR.slice(0, 3),
      { id: "d-long", label: "Retail Partnerships and Wholesale", icon: NORTHWIND_SIDEBAR[4]!.icon, href: "#", group: "department", dept: "dept-3", badge: 12 },
      { id: "d-longer", label: "Regulatory, Certification and Product Safety across the EU and UK", icon: NORTHWIND_SIDEBAR[7]!.icon, href: "#", group: "department", dept: "dept-6" },
      ...NORTHWIND_SIDEBAR.slice(9),
    ]),
    activeId: "d-long",
  },
  render: (args) => <Frame {...args} />,
};
