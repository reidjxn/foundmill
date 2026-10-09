import type { Meta, StoryObj } from "@storybook/react-vite";
import { AGENT_STATUSES, DEPT_COLOUR_TOKENS } from "@foundmill/shared";
import { AVATAR_PRESENCES, AVATAR_SIZES, Avatar, AvatarStack } from "./Avatar";

const meta = {
  title: "Foundation/Avatar",
  component: Avatar,
  parameters: {
    docs: {
      description: {
        component:
          "Agents are a procedural head-and-shoulders portrait seeded by avatar_seed in their department's palette; humans are initials on surface 2. The status ring is 1.5 px a few px out; `presence` adds the breathing ring (live, working) and a dot cut out of the surface. Every state is named in the label. Server-safe: the breathing is CSS.",
      },
    },
  },
  args: { name: "Juno", agent: { seed: "juno", dept: "dept-3" }, status: "healthy", size: 36 },
  argTypes: {
    size: { control: "select", options: AVATAR_SIZES },
    status: { control: "select", options: AGENT_STATUSES },
    presence: { control: "select", options: [undefined, ...AVATAR_PRESENCES] },
  },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Agent: Story = {};
export const Live: Story = { args: { presence: "live", size: 68 } };
export const Human: Story = { args: { name: "Ada Lovelace", agent: undefined, status: undefined } };
export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-6">
      <div className="flex items-end gap-4">
        {AVATAR_SIZES.map((s) => (
          <Avatar key={s} {...args} size={s} />
        ))}
      </div>
      <div className="flex items-end gap-4">
        {AVATAR_SIZES.map((s) => (
          <Avatar key={`h${s}`} name="Ada Lovelace" size={s} />
        ))}
      </div>
    </div>
  ),
};
export const StatusRings: Story = {
  render: () => (
    <div className="flex items-center gap-6">
      {AGENT_STATUSES.map((s) => (
        <div key={s} className="flex flex-col items-center gap-2">
          <Avatar name={s} agent={{ seed: s, dept: "dept-1" }} status={s} size={48} />
          <span className="text-small text-secondary">{s}</span>
        </div>
      ))}
    </div>
  ),
};
/** Presence is shape and words as well as colour: live and working breathe, away is hollow, down carries a bar. */
export const Presence: Story = {
  render: () => (
    <div className="flex flex-col gap-6">
      {[24, 36, 68].map((size) => (
        <div key={size} className="flex items-center gap-8">
          {AVATAR_PRESENCES.map((p) => (
            <div key={p} className="flex w-24 flex-col items-center gap-2">
              <Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} status={p === "down" ? "injured" : "healthy"} presence={p} size={size} />
              {size === 68 ? <span className="text-small text-secondary">{p}</span> : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
};
/** The presence dot's cut-out follows the surface behind it. */
export const OnSurfaces: Story = {
  render: () => (
    <div className="flex gap-3">
      {(
        [
          ["canvas", "bg-canvas"],
          ["rail", "bg-rail"],
          ["surface-1", "bg-surface-1"],
          ["surface-2", "bg-surface-2"],
          ["surface-3", "bg-surface-3"],
        ] as const
      ).map(([surface, bg]) => (
        <div key={surface} className={`flex flex-col items-center gap-2 rounded-md p-4 ${bg}`}>
          <Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} status="healthy" presence="available" surface={surface} size={36} />
          <span className="text-small text-secondary">{surface}</span>
        </div>
      ))}
    </div>
  ),
};
/** The conversation's presence column: the 68 px live portrait, name, role and live state. */
export const PresenceColumn: Story = {
  render: () => (
    <div className="surface-panel glow-dept tone-dept-3 flex w-44 flex-col gap-2 p-4">
      <Avatar name="Juno" agent={{ seed: "juno", dept: "dept-3" }} status="healthy" presence="live" size={68} />
      <div>
        <p className="t-display-md text-primary">Juno</p>
        <p className="text-small text-tertiary">Head of Retail Partnerships</p>
      </div>
      <p className="flex items-center gap-1.5 text-small text-status-good">
        <span className="typing-dots tone-status-good">
          <span />
          <span />
          <span />
        </span>
        Live · typing
      </p>
    </div>
  ),
};
export const DepartmentPalettes: Story = {
  render: () => (
    <div className="grid grid-cols-8 gap-4">
      {DEPT_COLOUR_TOKENS.map((d) =>
        [1, 2, 3].map((n) => <Avatar key={`${d}-${n}`} name={`${d} ${n}`} agent={{ seed: `${d}-${n}`, dept: d }} size={48} />),
      )}
    </div>
  ),
};
export const Stack: Story = {
  render: () => (
    <div className="surface-panel inline-flex p-4">
      <AvatarStack
        size={24}
        max={5}
        items={Array.from({ length: 8 }, (_, i) => ({ name: `Agent ${i + 1}`, agent: { seed: `a${i}`, dept: "dept-2" as const }, status: i % 3 === 0 ? ("degraded" as const) : ("healthy" as const) }))}
      />
    </div>
  ),
};
