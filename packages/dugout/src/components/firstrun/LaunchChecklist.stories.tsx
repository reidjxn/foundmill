import type { Meta, StoryObj } from "@storybook/react-vite";
import { launchChecklist } from "@foundmill/shared/launch-checklist";
import { LaunchChecklist } from "./LaunchChecklist";

const content = { pitch: "Fresh bread on your street every morning", about: "We bake sourdough and rye overnight and bring it to your door before 7 AM. ".repeat(6), forWhom: "", stage: "idea", showFounders: false, followForm: true } as const;

const meta = {
  title: "Guidance/LaunchChecklist",
  component: LaunchChecklist,
  parameters: {
    docs: {
      description: {
        component:
          "Before it goes live: a short list in the dialog where the founder approves the public page going live for the first time. Each row is Ready (a check) or Not yet (a circle) with one plain sentence and, where there is one, a single ghost action. It never blocks: the dialog's Publish button is unchanged, and the closing line says publishing works either way.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="p-4">
        <Story />
      </div>
    ),
  ],
  args: { onAction: () => {} },
} satisfies Meta<typeof LaunchChecklist>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AllReady: Story = { args: { items: launchChecklist({ name: "Maple Bakes", content }) } };
export const SomeNotYet: Story = { args: { items: launchChecklist({ name: "Maple Bakes", content: { ...content, about: "Sourdough at your door.", followForm: false } }) } };
