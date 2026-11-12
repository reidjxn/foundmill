import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { CallControls, type CallControlsProps } from "./CallControls";

const base: CallControlsProps = {
  kind: "team",
  micOn: true,
  micLevel: 0.45,
  onToggleMic: () => {},
  onSubmitText: () => {},
  captionsOn: true,
  onToggleCaptions: () => {},
  transcriptOn: false,
  onToggleTranscript: () => {},
  onEnd: () => {},
};

function Stateful(props: Partial<CallControlsProps>) {
  const [micOn, setMicOn] = useState(props.micOn ?? true);
  const [discussOn, setDiscussOn] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [transcriptOn, setTranscriptOn] = useState(false);
  return (
    <CallControls
      {...base}
      {...props}
      micOn={micOn}
      micLevel={0.45}
      onToggleMic={() => setMicOn((v) => !v)}
      onSubmitText={() => {}}
      discussOn={discussOn}
      onDiscussChange={setDiscussOn}
      captionsOn={captionsOn}
      onToggleCaptions={() => setCaptionsOn((v) => !v)}
      transcriptOn={transcriptOn}
      onToggleTranscript={() => setTranscriptOn((v) => !v)}
      onEnd={() => {}}
    />
  );
}

const meta = {
  title: "Call/CallControls",
  component: CallControls,
  parameters: {
    layout: "padded",
    docs: { description: { component: "The bottom bar. M toggles the mic (not while typing); Esc leaves the field and never ends the call. End is danger and reads \"End call and file actions\" on a team call, \"End call\" on a one-to-one." } },
  },
  args: base,
  decorators: [(Story) => <div className="w-[1100px]">{Story()}</div>],
} satisfies Meta<typeof CallControls>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TeamCall: Story = { render: (args) => <Stateful {...args} /> };
export const OneToOne: Story = { args: { kind: "one_to_one" }, render: (args) => <Stateful {...args} /> };
export const MicOff: Story = { args: { micOn: false }, render: (args) => <Stateful {...args} /> };
export const NoMicrophone: Story = { args: { micUnavailable: true, micOn: false }, render: (args) => <Stateful {...args} /> };
export const Ending: Story = { args: { ending: true }, render: (args) => <Stateful {...args} /> };
export const ReadOnly: Story = { args: { disabled: true }, render: (args) => <Stateful {...args} /> };
