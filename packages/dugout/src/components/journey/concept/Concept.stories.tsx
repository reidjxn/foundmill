import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { conceptFixtures } from "../fixtures";
import { ConceptCard } from "./ConceptCard";
import { ConceptCompare } from "./ConceptCompare";

const concepts = conceptFixtures();

const meta = {
  title: "Journey/ConceptCard",
  component: ConceptCard,
  parameters: { docs: { description: { component: "Ideation Studio profile cards (BUILD §11.1, DESIGN §9): logo, name, pitch, current and potential stars, ten attributes as 20-cell ramp bars with evidence on hover and, on every attribute label, a focusable tooltip that says what it measures and which way it reads (\"Competition: higher means less crowded\"). Actions: Shortlist, More like this (a variant), Ask, Merge, Discard. Compare lays 2–4 cards side by side with a radar in department colors and the agent verdict." } } },
  args: { concept: concepts[0]! },
} satisfies Meta<typeof ConceptCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {};
/** Hover or focus any attribute label: the tooltip says what it measures and which way it reads (A6). */
export const AttributeDefinitions: Story = { name: "Attribute definitions on the labels", args: { concept: concepts[1]! }, parameters: { docs: { description: { story: "Every label is a focusable trigger: Tab to it or hover it to read the definition and the direction, whether or not evidence is attached to the bar." } } } };
/** A variant's long name wraps to two lines before anything is cut (DIRECTION #15); the version reads in words. */
export const LongName: Story = { name: "Long variant name", args: { concept: { ...concepts[2]!, id: "concept-long", name: "Soldesk variant for makerspaces with two locations", version: 3 } }, decorators: [(S) => <div style={{ width: 340 }}><S /></div>] };
export const Shortlisted: Story = { args: { concept: concepts[1]!, shortlisted: true, selected: true, onToggleSelect: () => {} } };

export const Deck: Story = {
  name: "Six cards with Compare selection",
  render: () => {
    const Demo = () => {
      const [selected, setSelected] = useState<string[]>([concepts[0]!.id, concepts[1]!.id]);
      const [shortlist, setShortlist] = useState<string[]>([concepts[1]!.id]);
      const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
      const deck = [...concepts, { ...concepts[0]!, id: "concept-5", name: "Northwind Pro", version: 2, pitch: "The clinic channel: dermatologist-prescribed routines with practitioner margins." }, { ...concepts[3]!, id: "concept-6", name: "Studio Allan Live", version: 3 }];
      return (
        <div className="flex flex-col gap-gutter">
          <div className="flex flex-wrap gap-gutter">
            {deck.map((c) => (
              <ConceptCard key={c.id} concept={c} selected={selected.includes(c.id)} onToggleSelect={toggle} shortlisted={shortlist.includes(c.id)} onAction={(a, id) => a === "shortlist" && setShortlist((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))} />
            ))}
          </div>
          <ConceptCompare concepts={deck.filter((c) => selected.includes(c.id))} />
        </div>
      );
    };
    return <Demo />;
  },
};

export const CompareTwo: Story = { name: "Compare · 2", render: () => <ConceptCompare concepts={concepts.slice(0, 2)} /> };
export const CompareThree: Story = { name: "Compare · 3", render: () => <ConceptCompare concepts={concepts.slice(0, 3)} /> };
export const CompareFour: Story = { name: "Compare · 4", render: () => <ConceptCompare concepts={concepts} /> };

/** A narrow card: Shortlist and Ask become icon buttons with tooltips, "More like this" stays a labeled generate pill, Merge and Discard are in More. */
export const Narrow: Story = {
  render: (args) => (
    <div style={{ width: 300 }}>
      <ConceptCard {...args} className="w-full" onAction={() => {}} />
    </div>
  ),
};
