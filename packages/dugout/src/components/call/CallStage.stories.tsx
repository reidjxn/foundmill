import type { Meta, StoryObj } from "@storybook/react-vite";
import { CallStage } from "./CallStage";
import { AGENT_IDS, FOUNDER_NAME, ONE_TO_ONE_AGENT, TEAM_CALL_AGENTS, withPersonas } from "./fixtures";

const meta = {
  title: "Call/CallStage",
  component: CallStage,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: "The stage: one to nine tiles (up to eight agents and You) in a stable grid; each tile keeps its place while speakers change. In a one-to-one call the agent is large and You is small in its corner.",
      },
    },
  },
  args: { kind: "team", participants: TEAM_CALL_AGENTS, speakingAgentId: AGENT_IDS.product, founderName: FOUNDER_NAME, micOn: true, micLevel: 0.1 },
  decorators: [(Story) => <div className="w-[1000px]">{Story()}</div>],
} satisfies Meta<typeof CallStage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TeamCallPersonasOn: Story = { decorators: [withPersonas(true)] };
export const TeamCallPersonasOff: Story = { decorators: [withPersonas(false)] };
export const FounderSpeaking: Story = { args: { speakingAgentId: null, founderSpeaking: true, micLevel: 0.8 }, decorators: [withPersonas(true)] };
export const Thinking: Story = { args: { speakingAgentId: null, thinkingAgentIds: [AGENT_IDS.growth] }, decorators: [withPersonas(true)] };
export const OneToOnePersonasOn: Story = { args: { kind: "one_to_one", participants: [ONE_TO_ONE_AGENT] }, decorators: [withPersonas(true)] };
export const OneToOnePersonasOff: Story = { args: { kind: "one_to_one", participants: [ONE_TO_ONE_AGENT] }, decorators: [withPersonas(false)] };
export const NineTiles: Story = {
  args: {
    participants: Array.from({ length: 8 }, (_, i) => ({ ...TEAM_CALL_AGENTS[i % 5]!, agentId: `a2000000-0000-4000-8000-00000000000${i}`, colourToken: `dept-${(i % 8) + 1}` })),
    speakingAgentId: "a2000000-0000-4000-8000-000000000003",
  },
  decorators: [withPersonas(true)],
};
