import type { Meta, StoryObj } from "@storybook/react-vite";
import { CallCaptions } from "./CallCaptions";
import { TEAM_CALL_AGENTS, TEAM_CALL_TURNS, withPersonas } from "./fixtures";

const meta = {
  title: "Call/CallCaptions",
  component: CallCaptions,
  parameters: {
    docs: { description: { component: "The current line under the stage: the speaker's label (labelFor) and the words, with teammates' names rendered as EntityLinks. A fixed-height live region." } },
  },
  args: { speaker: TEAM_CALL_AGENTS[1]!, text: TEAM_CALL_TURNS[2]!.text },
  decorators: [(Story) => <div className="w-[880px] py-3">{Story()}</div>],
} satisfies Meta<typeof CallCaptions>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PersonasOn: Story = { decorators: [withPersonas(true)] };
export const PersonasOff: Story = { decorators: [withPersonas(false)] };
export const Founder: Story = { args: { speaker: "founder", text: "I want to open the waitlist next week." }, decorators: [withPersonas(true)] };
export const Empty: Story = { args: { speaker: null, text: null } };
