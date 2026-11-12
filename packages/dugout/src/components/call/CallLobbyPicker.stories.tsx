import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CallLobbyPicker, type CallLobbyPickerProps } from "./CallLobbyPicker";
import { TEAM_CALL_AGENTS, withPersonas } from "./fixtures";

const MORE = Array.from({ length: 5 }, (_, i) => ({ ...TEAM_CALL_AGENTS[(i + 1) % 5]!, agentId: `a3000000-0000-4000-8000-00000000000${i}`, isChiefOfStaff: false, name: `Specialist ${i + 1}`, role: `Specialist ${i + 1}`, personaKey: null }));

function Stateful(props: Partial<CallLobbyPickerProps>) {
  const [selected, setSelected] = useState<string[]>(TEAM_CALL_AGENTS.slice(0, 3).map((a) => a.agentId));
  return <CallLobbyPicker agents={[...TEAM_CALL_AGENTS.slice().reverse(), ...MORE]} selected={selected} onChange={setSelected} {...props} />;
}

const meta = {
  title: "Call/CallLobbyPicker",
  component: CallLobbyPicker,
  parameters: { docs: { description: { component: "Who is on a team call: a checklist of agent rows with the Chief of Staff first, at most eight." } } },
  args: { agents: TEAM_CALL_AGENTS, selected: [], onChange: () => {} },
  decorators: [(Story) => <div className="surface-panel w-[420px] p-3">{Story()}</div>],
} satisfies Meta<typeof CallLobbyPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PersonasOn: Story = { decorators: [withPersonas(true)], render: () => <Stateful /> };
export const PersonasOff: Story = { decorators: [withPersonas(false)], render: () => <Stateful /> };
export const AtTheLimit: Story = { decorators: [withPersonas(true)], render: () => <Stateful max={3} /> };
