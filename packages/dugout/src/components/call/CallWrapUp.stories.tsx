import type { Meta, StoryObj } from "@storybook/react-vite";
import { CallWrapUp } from "./CallWrapUp";
import { DEPARTMENT_NAMES, TEAM_CALL_ACTIONS, TEAM_CALL_AGENTS, TEAM_CALL_SUMMARY, withPersonas } from "./fixtures";

const meta = {
  title: "Call/CallWrapUp",
  component: CallWrapUp,
  parameters: { layout: "padded", docs: { description: { component: "The ended call: the summary, then what the team will do grouped by department (names passed in by the caller) with a status chip on each action, a link to where it went, and the one-line count." } } },
  args: {
    summary: TEAM_CALL_SUMMARY,
    actions: TEAM_CALL_ACTIONS,
    participants: TEAM_CALL_AGENTS,
    departmentName: (id: string) => DEPARTMENT_NAMES[id] ?? "Department",
    onOpenTarget: () => {},
  },
  decorators: [(Story) => <div className="w-[880px]">{Story()}</div>],
} satisfies Meta<typeof CallWrapUp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PersonasOn: Story = { decorators: [withPersonas(true)] };
export const PersonasOff: Story = { decorators: [withPersonas(false)] };
export const NothingToFile: Story = { args: { actions: [], summary: "You talked through the week. Nothing needed filing." } };
