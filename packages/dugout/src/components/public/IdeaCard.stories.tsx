import type { Meta, StoryObj } from "@storybook/react-vite";
import { IdeaCard, type IdeaCardData } from "./IdeaCard";

const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
const VALUES = [13, 9, 11, 16, 12, 14, 10, 7, 18, 15];
const card: IdeaCardData = {
  name: "Firstframe",
  pitch: "Restored 35 mm cameras, tested and sold with a roll of film and a ten-minute start guide, for people buying their first one.",
  archetype: "dtc_physical",
  stars_current: 3,
  stars_potential: 4,
  attributes: KEYS.map((key, i) => ({ key, value: VALUES[i]!, evidence: "Film photography forums show steady demand from first-time buyers; repair skills are scarce." })),
};

/** The idea box's card (docs/IDEA_BOX.md): landed, filling in, and once Founder fit is known. */
const meta = {
  title: "Public/IdeaCard",
  component: IdeaCard,
  parameters: { layout: "centered" },
  args: { card, justIn: true },
} satisfies Meta<typeof IdeaCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Landed: Story = {};
export const Drafting: Story = { args: { drafting: true, justIn: false, card: { name: "Firstframe", pitch: card.pitch, attributes: card.attributes!.slice(0, 4) } } };
export const NameOnly: Story = { args: { drafting: true, justIn: false, card: { name: "Firstframe" } } };
export const Sample: Story = { args: { sample: true } };
export const FounderFitKnown: Story = { args: { founderFitKnown: true, justIn: false } };
