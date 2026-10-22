import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { GuidanceProvider } from "./GuidanceProvider";
import { ReassuranceLine } from "./ReassuranceLine";

const meta = {
  title: "Guidance/ReassuranceLine",
  component: ReassuranceLine,
  parameters: {
    docs: {
      description: {
        component:
          "One sentence of reassurance under a first-run commitment or in a dialog footer (UX plan §6.2, principle 7): small tertiary text with a 14 px Undo2 (it can be undone) or Settings (where to change it) icon. Hidden when guidance is off: it is tutoring.",
      },
    },
  },
  args: { children: "You can change this later in Settings › Business." },
  decorators: [(Story) => <div className="w-96 p-4"><Story /></div>],
} satisfies Meta<typeof ReassuranceLine>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Undo: Story = {};
export const Settings: Story = { args: { icon: "settings", children: "Guidance is off for experienced founders. Turn it on any time in Settings › Preferences." } };

/** Under a primary action in a first-run form. */
export const UnderAnAction: Story = {
  name: "Under an action",
  render: () => (
    <div className="flex flex-col gap-2">
      <Button variant="primary" className="w-fit">
        Save and continue
      </Button>
      <ReassuranceLine>You can change this later in Settings › Business.</ReassuranceLine>
    </div>
  ),
};

/** Guidance off: gone. */
export const GuidanceOff: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off" }}>
        <p className="mb-2 text-small text-secondary">(nothing under this line)</p>
        <Story />
      </GuidanceProvider>
    ),
  ],
};
