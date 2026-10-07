import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { Kbd } from "../foundation/Kbd";
import { KeyboardHelp } from "./KeyboardHelp";
import { DEPARTMENTS_FOR_KEYS } from "./fixtures";

const meta = {
  title: "Shell/KeyboardHelp",
  component: KeyboardHelp,
  parameters: { docs: { description: { component: "Every BUILD §5.5 shortcut with its keys, plus one “Go to” chord per department with letters de-duplicated from the names. Opens on ? inside the AppShell." } } },
  args: { open: true, onOpenChange: () => {}, departments: DEPARTMENTS_FOR_KEYS },
} satisfies Meta<typeof KeyboardHelp>;
export default meta;
type Story = StoryObj<typeof meta>;

function Frame(args: Story["args"]) {
  const [open, setOpen] = useState(args?.open ?? true);
  return (
    <div className="flex items-center gap-2">
      <Button onClick={() => setOpen(true)}>Keyboard shortcuts</Button>
      <span className="text-small text-secondary">
        or press <Kbd>?</Kbd>
      </span>
      <KeyboardHelp {...args} open={open} onOpenChange={setOpen} />
    </div>
  );
}
export const Open: Story = { render: (args) => <Frame {...args} /> };
export const NoDepartments: Story = { args: { departments: [] } };
