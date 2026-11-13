import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { OnWaitlistCard } from "./OnWaitlistCard";

/** "You're on the list." for a signed-in person the admission did not let in today, at phone width (package 2.2). */
const meta = {
  title: "Public/OnWaitlistCard",
  component: OnWaitlistCard,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Shown wherever the api refuses a signed-in person with `on_waitlist`: “You're on the list. We'll let you in as soon as there is room. Come back tomorrow to check.” (no email is promised while nothing records who waits), the address that signed in, and the way on (Sign out, a link onward). Every control is at least 44 px tall.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof OnWaitlistCard>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone bg-canvas px-gutter py-6">
    <Story />
  </div>
);
const actions = (
  <>
    <Button variant="secondary" size="lg" className="min-h-tap">
      Sign out
    </Button>
    <Button asChild variant="ghost" size="lg" className="min-h-tap">
      <a href="#example">Look around an example</a>
    </Button>
  </>
);

export const Plain390: Story = { name: "390 px", decorators: [Phone] };
export const SignedIn390: Story = { name: "390 px · with the way on", decorators: [Phone], args: { email: "maya@example.com", actions } };
export const Desktop: Story = { name: "1280 px", decorators: [(Story) => <div className="@container w-[480px] bg-canvas p-6"><Story /></div>], args: { email: "maya@example.com", actions } };
