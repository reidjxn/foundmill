import type { Meta, StoryObj } from "@storybook/react-vite";
import { QuestionList } from "./QuestionList";

/** The landing page's questions: native details, closed until opened, by keyboard or tap. */
const meta = {
  title: "Landing/QuestionList",
  component: QuestionList,
  parameters: { layout: "padded" },
  decorators: [(Story) => <div className="landing-page landing-measure p-6">{Story()}</div>],
  args: {
    items: [
      { id: "cost", question: "Does it cost anything?", answer: "Starting is free and you never enter a card." },
      { id: "solo", question: "Can I do this on my own?", answer: "Yes, all of it." },
      { id: "together", question: "Can I build it with someone?", answer: "Yes. Invite as many cofounders and collaborators as you like, free on every plan." },
    ],
  },
} satisfies Meta<typeof QuestionList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Questions: Story = {};
