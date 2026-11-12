import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SpeechAccentPicker, type SpeechAccentPickerProps } from "./SpeechAccentPicker";

function Stateful(props: Partial<SpeechAccentPickerProps>) {
  const [value, setValue] = useState("elara");
  return <SpeechAccentPicker value={value} defaultKey="talia" onChange={setValue} onPreview={() => {}} {...props} />;
}

const meta = {
  title: "Call/SpeechAccentPicker",
  component: SpeechAccentPicker,
  parameters: { docs: { description: { component: "One agent's accent (how it sounds on calls): grouped Women's and Men's with each tone, the agent's default marked, and Hear it. Controlled; plays nothing itself." } } },
  args: { value: "elara", defaultKey: "talia", onChange: () => {} },
  decorators: [(Story) => <div className="surface-panel w-[420px] p-3">{Story()}</div>],
} satisfies Meta<typeof SpeechAccentPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { render: () => <Stateful /> };
export const OnTheDefault: Story = { render: () => <Stateful defaultKey="elara" /> };
export const Disabled: Story = { render: () => <Stateful disabled disabledReason="Only people who can edit the team change how it sounds." /> };
