import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Sidebar } from "./Sidebar";
import { withSidebarKeys } from "./AppShell";
import { kitStyle } from "./KitBar";
import { LEDGERLY_KIT, NORTHWIND_KIT, NORTHWIND_SIDEBAR } from "./fixtures";

const meta = {
  title: "Shell/Sidebar",
  component: Sidebar,
  parameters: { layout: "fullscreen", docs: { description: { component: "232 px on the rail (64 px collapsed), its inner hairline catching light at the top. Items are 32 px, 10 px in from the edges, sentence case: a 16 px icon in text-3 (department icons carry a small dot in their color) and an action-style label; hover adds a 3.5% plate. Active: a brand plate (primary 30% → 7%) with a kit-lift ring and icon, and a lit 3 px edge with its glow at the rail's edge. Badges are 18 px glowing pills in the department color (red for the Inbox). Groups are separated by fading hairlines; the LIVE block's “Live” label is drawn only for a LIVE business (`live`), a Personal one keeps its Network item without it. Founder areas (`group: \"area\"`, docs/DESIGN.md §8): Today, Needs you, then Plan, Customers, Money, Product and Team, each with its fixed chord (G P, G C, G M, G R, G T) and a neutral badge summed from its departments; a department with no modules keeps its own item, dot and letter after Team. Contacts is a Customers tab (the item's collapsed tooltip says so). A long founder-defined label wraps to two lines and steps down to fit — never silently clipped. Arrow keys move, Enter opens; collapsed items show their label and chord as a tooltip. The foot ends with a ghost “?” cap that opens the keyboard shortcuts (`onHelp`, expanded only), the collapse toggle and, with the `brand` prop, the Foundmill wordmark aligned with the item icons; the wordmark is drawn only while expanded and the sidebar never shows the FM monogram." } } },
  args: { items: withSidebarKeys(NORTHWIND_SIDEBAR), activeId: "area-customers", collapsed: false, showLive: true, live: true, brand: { href: "#" }, onCollapsedChange: () => {}, onHelp: () => {} },
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
/** A Personal business: the LIVE block is reduced to the founder's own Network item, under the hairline, with no "Live" label. */
export const Personal: Story = { args: { items: withSidebarKeys(NORTHWIND_SIDEBAR.filter((it) => it.group !== "live" || it.id === "network")), live: false, activeId: "inbox" }, render: (args) => <Frame {...args} /> };
export const SideBySide: Story = {
  render: (args) => (
    <div className="flex h-screen gap-8 bg-canvas p-4" style={kitStyle(LEDGERLY_KIT)}>
      <Sidebar {...args} collapsed={false} className="h-full" />
      <Sidebar {...args} collapsed className="h-full" />
    </div>
  ),
};
/** The area group on its own: Product active (its badge sums its departments' unread notes), no module-less department. */
export const Areas: Story = {
  args: { items: withSidebarKeys(NORTHWIND_SIDEBAR.filter((it) => it.group !== "department")), activeId: "area-product" },
  render: (args) => <Frame {...args} />,
};
/** A founder may name a module-less department up to 80 characters: the label wraps to two lines and steps down; it is never cut silently. */
export const LongDepartmentNames: Story = {
  args: {
    items: withSidebarKeys([
      ...NORTHWIND_SIDEBAR.filter((it) => it.group === "main" || it.group === "area"),
      { id: "d-long", label: "Retail Partnerships and Wholesale", icon: NORTHWIND_SIDEBAR[3]!.icon, href: "#", group: "department", dept: "dept-3", badge: 12 },
      { id: "d-longer", label: "Regulatory, Certification and Product Safety across the EU and UK", icon: NORTHWIND_SIDEBAR[4]!.icon, href: "#", group: "department", dept: "dept-6" },
      ...NORTHWIND_SIDEBAR.filter((it) => it.group === "live" || it.group === "foot"),
    ]),
    activeId: "d-long",
  },
  render: (args) => <Frame {...args} />,
};
