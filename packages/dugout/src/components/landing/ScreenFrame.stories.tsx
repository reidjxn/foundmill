import type { Meta, StoryObj } from "@storybook/react-vite";
import { IdeaCard } from "../public/IdeaCard";
import { ScreenFrame } from "./ScreenFrame";

const KEYS = ["market_pull", "market_size", "competition", "speed_to_first_customer", "capital_intensity", "agent_executability", "founder_fit", "defensibility", "regulatory_load", "distribution_clarity"];
const VALUES = [14, 7, 9, 17, 18, 13, 10, 6, 18, 15];
const card = {
  name: "Sole Revival",
  pitch: "Sneaker cleaning and restoring for students at one college, picked up and dropped off on campus.",
  archetype: "services",
  stars_current: 3,
  stars_potential: 4,
  attributes: KEYS.map((key, i) => ({ key, value: VALUES[i]!, evidence: "Students already pay for shoe care nearby." })),
};

/** A real screen on the landing page, labeled Example: a hairline and a chip, no surface of its own. */
const meta = {
  title: "Landing/ScreenFrame",
  component: ScreenFrame,
  parameters: { layout: "padded" },
  decorators: [(Story) => <div className="landing-page max-w-sm p-6">{Story()}</div>],
  args: { children: <IdeaCard card={card} className="max-w-full" /> },
} satisfies Meta<typeof ScreenFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ExampleCard: Story = {};
export const ExampleProject: Story = { args: { label: "Example project" } };
