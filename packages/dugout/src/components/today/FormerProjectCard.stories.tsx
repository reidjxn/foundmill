import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { FormerProjectCard } from "./FormerProjectCard";

const meta = {
  title: "Today/FormerProjectCard",
  component: FormerProjectCard,
  parameters: {
    docs: {
      description: {
        component:
          "On the home of a founder someone else demoted or removed within 30 days before a deletion request, or after it, while a deletion of that project waits: when it is deleted, until when they can stop it, and that stopping it gives them nothing else back. Cancel asks once more in place. No color, no badge, no count.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageGrid>
        <Story />
      </PageGrid>
    ),
  ],
  args: { projectName: "Bread by Bike", scheduledFor: "Nov 20, 2026", until: "Nov 19, 2026 at 3:45 PM", onCancel: () => {}, span: 12 },
} satisfies Meta<typeof FormerProjectCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Canceling: Story = { args: { pending: true } };
export const Done: Story = { args: { done: true } };
export const Refused: Story = { args: { error: "This deletion can no longer be canceled from here. The project's founders can cancel it in Settings › Danger zone." } };
/** At 390 px (the outer product's phone width): the words wrap and the buttons stack. */
export const Phone: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 390 }}>
        <Story />
      </div>
    ),
  ],
};
