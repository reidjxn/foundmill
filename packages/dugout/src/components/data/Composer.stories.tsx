import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { Composer } from "./Composer";

const meta = {
  title: "Data/Composer",
  component: Composer,
  parameters: { layout: "padded" },
  args: { "aria-label": "Write a message", placeholder: "Write a message", onSubmit: () => undefined },
} satisfies Meta<typeof Composer>;
export default meta;

type Story = StoryObj<typeof meta>;

function DefaultDemo(args: ComponentProps<typeof Composer>) {
  const [sent, setSent] = useState<string[]>([]);
  return (
    <div className="surface-panel flex w-[480px] flex-col gap-3 p-panel-pad">
      <Composer {...args} onSubmit={(body) => setSent((s) => [...s, body])} note="Only you send messages here." />
      <ul className="text-small text-secondary" aria-label="Sent">
        {sent.map((s, i) => (
          <li key={i}>Sent: {s}</li>
        ))}
      </ul>
    </div>
  );
}

/** Ctrl+Enter or Cmd+Enter sends; plain Enter is a new line. The field clears once `onSubmit` resolves. */
export const Default: Story = { render: (args) => <DefaultDemo {...args} /> };

/** A slow request: the button shows its spinner and a second press is ignored. */
export const Sending: Story = {
  render: (args) => (
    <div className="surface-panel w-[480px] p-panel-pad">
      <Composer {...args} onSubmit={() => new Promise((resolve) => setTimeout(resolve, 2500))} label="Post" aria-label="Write a post" />
    </div>
  ),
};

/** A failed request keeps the text so nothing is lost. */
export const Failing: Story = {
  render: (args) => (
    <div className="surface-panel w-[480px] p-panel-pad">
      <Composer {...args} onSubmit={() => Promise.reject(new Error("Offline"))} note="The next send fails; the text stays." />
    </div>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <div className="surface-panel w-[480px] p-panel-pad">
      <Composer {...args} disabled note="Join the community to post." />
    </div>
  ),
};
