import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type ComponentProps } from "react";
import { Conversation, type ConversationMessage } from "./Conversation";

// Relative to the clock, so "5 min ago" reads right whenever the story is opened.
const NOW = Date.now();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

const MESSAGES: ConversationMessage[] = [
  { id: "1", author: "Priya Nair", body: "Hi Jamie, I saw your note on reply times in the fintech ops room. Do you have ten minutes this week?", at: at(190) },
  { id: "2", author: "You", self: true, body: "Thursday after 2 works.\nI will send an invite.", at: at(160) },
  { id: "3", author: "Priya Nair", body: "Perfect.", at: at(12) },
];

const meta = {
  title: "Data/Conversation",
  component: Conversation,
  parameters: { layout: "padded" },
  args: { label: "Conversation with Priya Nair", messages: MESSAGES, onSend: () => undefined },
} satisfies Meta<typeof Conversation>;
export default meta;

type Story = StoryObj<typeof meta>;

function DefaultDemo(args: ComponentProps<typeof Conversation>) {
  const [messages, setMessages] = useState(args.messages);
  return (
    <div className="surface-panel flex h-96 w-[560px] flex-col">
      <Conversation
        {...args}
        messages={messages}
        note="Agents may draft a message for you, but only you can send it."
        onSend={(body) => setMessages((m) => [...m, { id: String(m.length + 1), author: "You", self: true, body, at: new Date().toISOString() }])}
      />
    </div>
  );
}

export const Default: Story = { render: (args) => <DefaultDemo {...args} /> };

export const Empty: Story = {
  args: { messages: [], empty: "No messages with Priya yet. Say hello." },
  render: (args) => (
    <div className="surface-panel flex h-80 w-[560px] flex-col">
      <Conversation {...args} />
    </div>
  ),
};

export const Loading: Story = {
  args: { loading: true },
  render: (args) => (
    <div className="surface-panel flex h-80 w-[560px] flex-col">
      <Conversation {...args} />
    </div>
  ),
};

export const Failed: Story = {
  args: { error: "The messages could not load.", onRetry: () => undefined },
  render: (args) => (
    <div className="surface-panel flex h-80 w-[560px] flex-col">
      <Conversation {...args} />
    </div>
  ),
};
