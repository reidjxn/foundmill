import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { ArrowLeft, Mail } from "lucide-react";
import { Button } from "../foundation/Button";
import { NeedsLargerWindow } from "./NeedsLargerWindow";

const meta = {
  title: "Shell/NeedsLargerWindow",
  component: NeedsLargerWindow,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Centered and mark-less (no business logo, no Foundmill mark), display-md title, the body line, then the ways on that the page passes as `actions` (on the web: “Email me a link” and a way back), so a small screen is never a dead end (DESIGN §8). The width line in mono shows only with `showWidth`. Rendered alone below 1280 px.",
      },
    },
  },
  args: { width: 1279 },
} satisfies Meta<typeof NeedsLargerWindow>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="w-phone">
    <Story />
  </div>
);

const actions = (
  <>
    <Button variant="primary" size="lg" icon={Mail} className="min-h-tap w-full">
      Email me a link
    </Button>
    <Button variant="ghost" icon={ArrowLeft} className="min-h-tap w-full">
      Back to Today
    </Button>
  </>
);

export const WithActions390: Story = { name: "390 px · with the ways on", decorators: [Phone], args: { width: 390, actions } };
export const Bare390: Story = { name: "390 px · without actions", decorators: [Phone], args: { width: 390 } };
export const At1279WithWidth: Story = { name: "1279 px · with the width line", args: { width: 1279, showWidth: true } };
export const Unmeasured: Story = { args: { width: undefined } };
