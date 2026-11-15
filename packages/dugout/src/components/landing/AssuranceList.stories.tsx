import type { Meta, StoryObj } from "@storybook/react-vite";
import { Lock, Medal, ShieldCheck } from "lucide-react";
import { AssuranceList } from "./AssuranceList";

/** The landing page's assurances: all three at every width. */
const meta = {
  title: "Landing/AssuranceList",
  component: AssuranceList,
  parameters: { layout: "padded" },
  decorators: [(Story) => <div className="landing-page p-6">{Story()}</div>],
  args: {
    items: [
      { icon: Medal, text: "Your first card is free and needs no sign-up" },
      { icon: Lock, text: "Your idea stays private until you choose to share it" },
      { icon: ShieldCheck, text: "Nothing spends money or signs in your name without you" },
    ],
  },
} satisfies Meta<typeof AssuranceList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Three: Story = {};
