import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { DiffView, type DiffViewProps } from "./DiffView";
import type { HunkDecisions } from "./diff";
import { SPEC_BASE, SPEC_ORIGINAL, SPEC_PROPOSED } from "./fixtures";

const meta = {
  title: "Data/DiffView",
  component: DiffView,
  parameters: { layout: "padded" },
  args: {
    original: SPEC_ORIGINAL,
    proposed: SPEC_PROPOSED,
    title: "Specification · Pricing and Packaging",
    contextLines: 2,
  },
} satisfies Meta<typeof DiffView>;
export default meta;

type Story = StoryObj<typeof meta>;

/** A change proposal with one hunk accepted and one rejected; the merged text updates below. */
function MixedHarness(args: DiffViewProps) {
  const [decisions, setDecisions] = useState<HunkDecisions>({
    h0: { decision: "accepted" },
    h1: { decision: "rejected" },
  });
  const [merged, setMerged] = useState<string>("");
  return (
    <div className="flex w-[960px] flex-col gap-3">
      <DiffView
        {...args}
        decisions={decisions}
        onDecision={(id, s, text) => {
          setDecisions((d) => ({ ...d, [id]: s }));
          setMerged(text);
        }}
      />
      <details className="surface-panel p-panel-pad">
        <summary className="t-label cursor-pointer">Merged text</summary>
        <pre className="mt-2 whitespace-pre-wrap font-mono text-mono text-primary">
          {merged || "(accept or reject a hunk)"}
        </pre>
      </details>
    </div>
  );
}

export const MixedDecisions: Story = {
  render: (args) => <MixedHarness {...args} />,
};

export const SideBySide: Story = {
  args: { defaultMode: "side-by-side" },
  render: (args) => (
    <div className="w-[1200px]">
      <DiffView {...args} />
    </div>
  ),
};

export const ReadOnly: Story = {
  args: {
    readOnly: true,
    decisions: {
      h0: { decision: "accepted" },
      h1: {
        decision: "edited",
        text: "Glass bottle with pump, recyclable carton.\nLabel printed in Sweden.\nCarton carries the CPNP number and a QR code.",
      },
    },
  },
  render: (args) => (
    <div className="w-[960px]">
      <DiffView {...args} />
    </div>
  ),
};

/** Base / ours / theirs: the founder edited the MOQ line while the Source Watcher proposed new prices. */
export const ThreeWay: Story = {
  args: {
    base: SPEC_BASE,
    labels: { base: "Published v3", original: "Your edits", proposed: "Proposal" },
  },
  render: (args) => (
    <div className="w-[1200px]">
      <DiffView {...args} />
    </div>
  ),
};

export const ThreeWayConflict: Story = {
  args: {
    base: "Retail price €39 per 50 ml.\nSubscription discount: 10%.",
    original: "Retail price €41 per 50 ml.\nSubscription discount: 10%.",
    proposed: "Retail price €42 per 50 ml.\nSubscription discount: 15%.",
    title: "Pricing block",
  },
  render: (args) => (
    <div className="w-[1200px]">
      <DiffView {...args} />
    </div>
  ),
};
