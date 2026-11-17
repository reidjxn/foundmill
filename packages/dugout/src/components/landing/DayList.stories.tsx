import type { Meta, StoryObj } from "@storybook/react-vite";
import { APP_NAME } from "@foundmill/config";
import { DayList } from "./DayList";

/** An example week on the landing page; a day that reaches a milestone says so in gold and in words. */
const meta = {
  title: "Landing/DayList",
  component: DayList,
  parameters: { layout: "padded" },
  decorators: [(Story) => <div className="landing-page landing-measure p-6">{Story()}</div>],
  args: {
    days: [
      { day: "Day 1", text: "The idea is shaped and rated: 3 stars, with room to reach 4." },
      { day: "Day 2", text: `The team drafts the project's page. The founder changes two lines and publishes it at its own ${APP_NAME} address.` },
      { day: "Day 3", text: "The founder sends the link to two group chats." },
      { day: "Day 5", text: "The project's story shows its first milestone: page live.", milestone: true },
      { day: "Day 7", text: "One decision is waiting, with the team's recommendation. Money the founder has spent: $0." },
    ],
  },
} satisfies Meta<typeof DayList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FirstWeek: Story = {};
