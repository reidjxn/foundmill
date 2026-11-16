import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { Kbd } from "../foundation/Kbd";
import { KeyboardHelp } from "./KeyboardHelp";
import { AREAS_FOR_KEYS, DEPARTMENTS_FOR_KEYS } from "./fixtures";

const meta = {
  title: "Shell/KeyboardHelp",
  component: KeyboardHelp,
  parameters: { docs: { description: { component: "Every BUILD §5.5 shortcut with its keys, plus one “Go to” chord per founder area (G P Plan, G C Customers, G M Money, G R Product, G T Team) and one per department with no modules, its letter chosen around the area letters. Opens on ? inside the AppShell." } } },
  args: { open: true, onOpenChange: () => {}, areas: AREAS_FOR_KEYS, departments: [{ id: "d-studio", name: "Studio" }] },
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
/** Areas only: every department belongs to a module, so no department chord is listed. */
export const NoDepartments: Story = { args: { departments: [] } };
/** A viewer walled from the Customers and Money areas: only the areas the sidebar shows get chords. */
export const SomeAreas: Story = { args: { areas: ["plan", "product", "team"], departments: [] } };
/** Before the founder areas, every department had a letter; the rule still gives module-less departments theirs. */
export const ManyModuleLessDepartments: Story = { args: { areas: AREAS_FOR_KEYS, departments: DEPARTMENTS_FOR_KEYS } };
/** Single keys turned on in Settings › Preferences (the default is off, and the description says where to turn them on). */
export const SingleKeysOn: Story = { args: { singleKeys: true } };
