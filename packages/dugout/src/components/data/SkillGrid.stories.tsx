import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { AttributeBars } from "./AttributeBars";
import { RatingBar, RatingFigure } from "./RatingBar";
import { SkillGrid } from "./SkillGrid";
import { BACKEND_SKILLS, CONCEPT_ATTRIBUTES } from "./fixtures";

const meta = {
  title: "Data/SkillGrid",
  component: SkillGrid,
  parameters: { layout: "padded" },
} satisfies Meta<typeof SkillGrid>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Backend engineer after a training run: deltas, two drops flagged, hover for Tested · Proven · tasks. */
export const BackendEngineer: Story = {
  args: { skills: BACKEND_SKILLS },
  render: (args) => (
    <div className="surface-panel w-[1120px] p-panel-pad">
      <SkillGrid {...args} />
    </div>
  ),
};

export const WithPotential: Story = {
  args: { skills: BACKEND_SKILLS, showPotential: true },
  render: (args) => (
    <div className="surface-panel w-[1120px] p-panel-pad">
      <SkillGrid {...args} />
    </div>
  ),
};

/** Training → Focus: pick up to three skills for the Coach to work on. */
function FocusHarness(args: Story["args"]) {
  const [selected, setSelected] = useState<string[]>(["debug", "cost"]);
  return (
    <div className="surface-panel w-[1120px] p-panel-pad">
      <SkillGrid {...args} focus={{ selected, onChange: setSelected }} />
    </div>
  );
}

export const FocusMode: Story = {
  args: { skills: BACKEND_SKILLS },
  render: (args) => <FocusHarness {...args} />,
};

export const RatingBars: Story = {
  args: { skills: [] },
  render: () => (
    <div className="flex w-80 flex-col gap-2">
      {[3, 8, 13, 18].map((v) => (
        <div key={v} className="flex items-center gap-3">
          <RatingFigure value={v} className="w-6 text-right" />
          <RatingBar value={v} compare={Math.min(20, v + 3)} name="Sample" />
        </div>
      ))}
    </div>
  ),
};

/** Ideation Studio concept card: ten attributes with evidence on hover; outlined cells are the comparison concept. */
export const ConceptAttributes: Story = {
  args: { skills: [] },
  render: () => (
    <div className="surface-panel w-[720px] p-panel-pad">
      <h3 className="t-display-sm mb-2 text-primary">Northwind Skincare · attributes</h3>
      <AttributeBars attributes={CONCEPT_ATTRIBUTES} columns={2} />
    </div>
  ),
};
