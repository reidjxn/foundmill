import type { Meta, StoryObj } from "@storybook/react-vite";
import { FoundationsStatus } from "./FoundationsStatus";
import { PageGrid } from "./PageGrid";

const meta = {
  title: "Shell/Foundations Status",
  component: FoundationsStatus,
  parameters: {
    docs: {
      description: {
        component:
          "The state of a new business's vision, specification and roadmap, drafted once when the business is first opened. Drafting shows an indeterminate ring, what the drafting reads and the three parts; ready offers the way in; failed gives the reason and Try again. The body is a polite live region, so the change is announced once. Pending reads as drafting.",
      },
    },
  },
  args: { state: "drafting", span: 12, basis: "From your idea and your founder profile.", onRetry: () => {}, onOpen: () => {} },
  argTypes: { state: { control: "select", options: ["pending", "drafting", "ready", "failed"] }, span: { control: "select", options: [4, 6, 8, 12] } },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Story />
      </PageGrid>
    ),
  ],
} satisfies Meta<typeof FoundationsStatus>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Drafting: Story = {};
export const DraftingFromImport: Story = { args: { basis: "From the Import report and the 3 sources you chose." } };
export const Pending: Story = { args: { state: "pending" } };
export const Ready: Story = { args: { state: "ready", summary: "10 specification sections · 11 roadmap items, 4 in Now" } };
export const Failed: Story = { args: { state: "failed", error: "The model service did not answer. Try again in a few minutes." } };
export const Retrying: Story = { args: { state: "failed", error: "The drafting took too long and was stopped. Try again.", retrying: true } };
export const InAColumn: Story = { args: { state: "drafting", span: 4, heading: "Foundations" } };
