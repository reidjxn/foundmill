import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import { PhoneBar, PhoneMenu } from "./PhoneBar";
import { NORTHWIND_KIT, NORTHWIND_SIDEBAR } from "./fixtures";
import { withSidebarKeys } from "./AppShell";

const meta = {
  title: "Shell/PhoneBar",
  component: PhoneBar,
  parameters: { layout: "centered", docs: { description: { component: "The shell's top bar and menu panel on a phone (390 px): a menu button, the business's logo and name, Continue and Stop all agents at 44 px. The menu holds the sidebar's items as 44 px rows with their badges, in a focus-trapped panel (Esc closes it)." } } },
  decorators: [
    (Story) => (
      <div className="w-phone border-x border-line">
        <Story />
      </div>
    ),
  ],
  args: {
    kit: NORTHWIND_KIT,
    logoSrc: SAMPLE_LOGOS.stack,
    businessName: "Northwind Skincare",
    continueButton: { state: { kind: "idle" } },
    stopAll: { onConfirm: () => {} },
    menuOpen: false,
    onMenuOpenChange: () => {},
  },
} satisfies Meta<typeof PhoneBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Bar390: Story = { name: "390 px · bar" };
export const NeedsYou390: Story = { name: "390 px · Continue says Needs you", args: { continueButton: { state: { kind: "blocked", count: 3 } } } };
export const LongName390: Story = { name: "390 px · a long business name truncates", args: { businessName: "Northwind Skincare and Sun Care Company" } };

function MenuStory(args: ComponentProps<typeof PhoneBar>) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <PhoneBar {...args} menuOpen={open} onMenuOpenChange={setOpen} />
      <div className="p-gutter">
        <Button onClick={() => setOpen(true)}>Open the menu</Button>
      </div>
      <PhoneMenu open={open} onOpenChange={setOpen} items={withSidebarKeys(NORTHWIND_SIDEBAR)} activeId="home" businessName={args.businessName} onSelect={() => {}} onSearch={() => {}} />
    </>
  );
}

export const Menu390: Story = { name: "390 px · menu open", render: (args) => <MenuStory {...args} /> };
