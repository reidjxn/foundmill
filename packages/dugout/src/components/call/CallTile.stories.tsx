import type { Meta, StoryObj } from "@storybook/react-vite";
import { CALL_TILE_STATES, CallTile } from "./CallTile";
import { FOUNDER_NAME, ONE_TO_ONE_AGENT, TEAM_CALL_AGENTS, withPersonas } from "./fixtures";

const meta = {
  title: "Call/CallTile",
  component: CallTile,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          'One tile of a Team call: 16:9, the agent\'s portrait large and centered, a name plate (name · role) and the "AI agent" marker. The agent is named and pictured through useAgentPersona() and Avatar, as at its desk: with anthropomorphic agents on, the persona name, the role and the AI portrait; off, the stored name and the drawn portrait. Speaking lights the edge in the department color with three level bars (still under reduced motion).',
      },
    },
  },
  args: { participant: ONE_TO_ONE_AGENT, state: "idle" },
  decorators: [(Story) => <div className="w-[420px]">{Story()}</div>],
} satisfies Meta<typeof CallTile>;
export default meta;
type Story = StoryObj<typeof meta>;

const allStates = (args: Story["args"]) => (
  <div className="grid w-[880px] grid-cols-2 gap-3">
    {CALL_TILE_STATES.map((state) => (
      <CallTile key={state} {...args} participant={args?.participant ?? ONE_TO_ONE_AGENT} state={state} />
    ))}
  </div>
);

export const PersonasOn: Story = { decorators: [withPersonas(true)], render: (args) => allStates(args) };
export const PersonasOff: Story = { decorators: [withPersonas(false)], render: (args) => allStates(args) };
export const Speaking: Story = { args: { state: "speaking", participant: TEAM_CALL_AGENTS[0] }, decorators: [withPersonas(true)] };
export const You: Story = {
  decorators: [withPersonas(true)],
  render: () => (
    <div className="grid w-[880px] grid-cols-3 gap-3">
      <CallTile founderName={FOUNDER_NAME} state="idle" micOn level={0} />
      <CallTile founderName={FOUNDER_NAME} state="speaking" micOn level={0.7} />
      <CallTile founderName={FOUNDER_NAME} state="idle" micOn={false} />
    </div>
  ),
};
