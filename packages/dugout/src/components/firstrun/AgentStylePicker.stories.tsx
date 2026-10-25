import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { AgentStyle } from "@foundmill/shared/personas";
import { Panel } from "../shell/Panel";
import { AgentStylePicker } from "./AgentStylePicker";

const meta = {
  title: "Guidance/AgentStylePicker",
  component: AgentStylePicker,
  parameters: {
    docs: {
      description: {
        component:
          "Four radio cards for the kind of character the team wears when anthropomorphic agents are on: Humans, 3D cartoon humans, 2D cartoon humans and animals, Fantasy. Controlled; the whole card is the target; arrow keys move between cards and Space selects.",
      },
    },
  },
  args: { value: "humans", onChange: () => undefined },
} satisfies Meta<typeof AgentStylePicker>;
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ start, disabled }: { start: AgentStyle; disabled?: boolean }) {
  const [style, setStyle] = useState<AgentStyle>(start);
  return (
    <Panel title="Agents" span={8}>
      <AgentStylePicker value={style} onChange={setStyle} disabled={disabled} />
    </Panel>
  );
}

export const Humans: Story = { render: () => <Controlled start="humans" /> };
export const Fantasy: Story = { render: () => <Controlled start="fantasy" /> };
export const Cartoon2d: Story = { render: () => <Controlled start="cartoon_2d" /> };
export const Disabled: Story = { render: () => <Controlled start="cartoon_3d" disabled /> };
