import type { Meta, StoryObj } from "@storybook/react-vite";
import { useRef } from "react";
import { Button } from "../foundation/Button";
import { VirtualList, type VirtualListHandle } from "./VirtualList";

const meta = {
  title: "Data/VirtualList",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;

type Story = StoryObj<typeof meta>;

interface Note {
  id: string;
  subject: string;
  lines: number;
}

const notes: Note[] = Array.from({ length: 2_000 }, (_, i) => ({ id: `note-${i}`, subject: `Note ${i + 1}: the weekly update from the team`, lines: 1 + (i % 3) }));

function Harness({ items, virtualizeAfter }: { items: readonly Note[]; virtualizeAfter?: number }) {
  const ref = useRef<VirtualListHandle>(null);
  return (
    <div className="flex w-[380px] flex-col gap-2">
      <Button size="sm" variant="ghost" onClick={() => ref.current?.scrollToIndex(1_500)}>
        Jump to note 1,501
      </Button>
      <div className="surface-panel flex h-[480px] flex-col">
        <VirtualList
          ref={ref}
          aria-label="Notes"
          className="flex min-h-0 flex-1 flex-col"
          items={items}
          getKey={(n) => n.id}
          virtualizeAfter={virtualizeAfter}
          rowClassName="border-b hairline-50"
          renderItem={(n) => (
            <div className="px-panel-pad py-2.5 text-body text-primary">
              {n.subject}
              {Array.from({ length: n.lines - 1 }, (_, i) => (
                <p key={i} className="text-small text-secondary">
                  A second line of detail, so rows are not all the same height.
                </p>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

/** Two thousand notes of different heights: only the rows near the viewport are in the page. */
export const TwoThousandNotes: Story = {
  render: () => <Harness items={notes} />,
};

/** A short list is drawn whole. */
export const ShortList: Story = {
  render: () => <Harness items={notes.slice(0, 12)} />,
};
