import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { WeekOutcomes } from "./WeekOutcomes";

/** A 390 px phone frame that is its own container, so the headline lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/WeekOutcomes",
  component: WeekOutcomes,
  parameters: {
    docs: {
      description: {
        component: "Today's headline: the week's real outcomes as one count, with what they were. Real records only: nothing simulated counts and no cost is shown. A week with none shows no count and no zero, only what the team is working toward.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="@container">
        <PageGrid>
          <Story />
        </PageGrid>
      </div>
    ),
  ],
  args: { span: 12, headline: "This week: 23 real outcomes", detail: "1 payment, 2 replies, 3 new followers, your page went live, 16 emails sent" },
} satisfies Meta<typeof WeekOutcomes>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const One: Story = { name: "One outcome", args: { headline: "This week: 1 real outcome", detail: "Your page went live" } };
export const NoneYet: Story = { name: "A week with none", args: { headline: null, detail: null, toward: "Working toward: Get the first 10 paying customers by Dec 19" } };
export const Phone390: Story = { name: "390 px", decorators: [Phone] };
