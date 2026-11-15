import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScreenFrame } from "./ScreenFrame";
import { LandingSection } from "./LandingSection";

/** One section of the landing page: heading, lede, words, and a real screen beside them from 1024 px. */
const meta = {
  title: "Landing/LandingSection",
  component: LandingSection,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <div className="landing-page">{Story()}</div>],
  args: {
    id: "people",
    title: "On your own, or with people",
    lede: "You can build all of it by yourself. Your team of agents covers the work, and nothing waits on a second person.",
    children: <p className="text-secondary">If you want people to build it with, they are one step away.</p>,
  },
} satisfies Meta<typeof LandingSection>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WordsOnly: Story = {};
export const WithScreen: Story = { args: { screen: <ScreenFrame><div className="h-64 rounded-md bg-surface-1" /></ScreenFrame> } };
export const Phone: Story = { args: { screen: <ScreenFrame><div className="h-64 rounded-md bg-surface-1" /></ScreenFrame> }, decorators: [(Story) => <div className="w-phone">{Story()}</div>] };
