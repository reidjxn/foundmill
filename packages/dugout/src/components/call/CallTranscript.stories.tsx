import type { Meta, StoryObj } from "@storybook/react-vite";
import { CallTranscript } from "./CallTranscript";
import { TEAM_CALL_AGENTS, TEAM_CALL_TURNS, withPersonas } from "./fixtures";

const meta = {
  title: "Call/CallTranscript",
  component: CallTranscript,
  parameters: { docs: { description: { component: "The right rail: every turn with its speaker label (labelFor; \"You\" for the founder), the time in the person's date format and the words. The turn being spoken is lit in the speaker's color." } } },
  args: { turns: TEAM_CALL_TURNS, participants: TEAM_CALL_AGENTS, speakingTurnId: "t4" },
  decorators: [(Story) => <div className="flex h-[520px] w-[320px] flex-col">{Story()}</div>],
} satisfies Meta<typeof CallTranscript>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PersonasOn: Story = { decorators: [withPersonas(true)], args: { onClose: () => {} } };
export const PersonasOff: Story = { decorators: [withPersonas(false)] };
export const Empty: Story = { args: { turns: [] } };
