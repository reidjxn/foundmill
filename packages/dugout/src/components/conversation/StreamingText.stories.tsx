import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { EntityText } from "../data/EntityText";
import { Button } from "../foundation/Button";
import { StreamingText } from "./StreamingText";
import { DESK_ENTITY_IDS } from "./fixtures";

const TEXT = `The bigger lever is the 60-day terms. If [[ent:${DESK_ENTITY_IDS.bootsUk}|Boots UK]] agrees to 45, December stays above £50K (Forecast).`;

const meta = {
  title: "Conversation/StreamingText",
  component: StreamingText,
  parameters: {
    docs: {
      description: {
        component:
          "Agent words arriving at 22–34 ms per character with a 120 ms pause at commas; the newest words in text-2 until they settle; a caret in the agent's colour while the stream is open. Mentions arrive whole. Reduced motion renders the text whole.",
      },
    },
  },
  args: { text: TEXT, tone: "dept-3", render: (t: string) => <EntityText>{t}</EntityText> },
  decorators: [
    (Story) => (
      <div className="max-w-reading text-chat text-primary">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StreamingText>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Reveals once, then settles (the caret goes). Replay with the button. */
export const Reveal: Story = {
  render: (args) => {
    const Demo = () => {
      const [k, setK] = useState(0);
      return (
        <div className="flex flex-col items-start gap-3">
          <StreamingText key={k} {...args} />
          <Button size="sm" onClick={() => setK((n) => n + 1)}>
            Replay
          </Button>
        </div>
      );
    };
    return <Demo />;
  },
};

/** A live source: chunks arrive every 600 ms and the caret stays open until the last one. */
export const LiveSource: Story = {
  render: (args) => {
    const Demo = () => {
      const chunks = [
        "Capital intensity: ",
        "one stability study ",
        "per product line ",
        "runs £2–4K ",
        "at a contract lab (Estimate).",
      ];
      const [n, setN] = useState(1);
      useEffect(() => {
        if (n >= chunks.length) return;
        const t = setTimeout(() => setN((x) => x + 1), 600);
        return () => clearTimeout(t);
      }, [n, chunks.length]);
      return (
        <StreamingText
          {...args}
          tone="dept-7"
          text={chunks.slice(0, n).join("")}
          open={n < chunks.length}
        />
      );
    };
    return <Demo />;
  },
};

/** History: already settled, shown whole. */
export const Settled: Story = { args: { animate: false } };
