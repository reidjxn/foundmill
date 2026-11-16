import type { Meta, StoryObj } from "@storybook/react-vite";
import { IdeaNextSteps } from "./IdeaNextSteps";

/**
 * Beside the landing page's idea card (founder, 2026-11-16): shape it in the Ideation Studio or start building it now,
 * then "Try another idea" behind a warning. At 390 and 1440 px.
 */
const meta = {
  title: "Public/IdeaNextSteps",
  component: IdeaNextSteps,
  parameters: { layout: "padded" },
  args: {
    name: "Billkeep",
    studioHref: "/login?next=%2Fstart%3Fthen%3Dstudio",
    buildHref: "/login?next=%2Fstart",
    redrawsLeft: 2,
    onRedraw: () => {},
    lead: <p className="t-landing-body text-prose">Either way, you sign in first so the idea stays yours.</p>,
  },
  decorators: [(Story) => <div className="@container w-full max-w-96">{Story()}</div>],
} satisfies Meta<typeof IdeaNextSteps>;
export default meta;
type Story = StoryObj<typeof meta>;

export const TwoRedrawsLeft: Story = {};
export const OneLeft: Story = { args: { redrawsLeft: 1 } };
/** No redraw left today: the line says so instead of the button. */
export const NoneLeft: Story = { args: { redrawsLeft: 0 } };
/** The api could not say how many are left: the button shows without a count. */
export const Unknown: Story = { args: { redrawsLeft: null } };
/** On a phone: the Studio opens on a computer. */
export const Phone: Story = { args: { studioOnComputer: true }, parameters: { viewport: { defaultViewport: "mobile1" } } };
/** The warning, opened. */
export const Confirming: Story = {
  play: async ({ canvasElement }) => {
    (canvasElement.querySelector("[data-testid=idea-try-another]") as HTMLButtonElement | null)?.click();
  },
};
