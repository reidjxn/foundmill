import type { Meta, StoryObj } from "@storybook/react-vite";
import { TypingLine } from "./TypingLine";

const meta = {
  title: "Conversation/TypingLine",
  component: TypingLine,
  parameters: {
    docs: {
      description: {
        component:
          'Shown only while a reply is genuinely in flight. It always names what the agent is looking at, in the agent\'s color (SPEC "Typing line").',
      },
    },
  },
  args: { name: "Juno", phrase: "Reading Boots UK's supplier terms", dept: "dept-3" },
} satisfies Meta<typeof TypingLine>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const CurrentTask: Story = {
  args: {
    name: "Formulation Chemist",
    phrase: "checking serum stability, day 21 of 28",
    dept: "dept-7",
  },
};
export const Indented: Story = { name: "Indented (beside portraits)", args: { indent: true } };
