import type { Meta, StoryObj } from "@storybook/react-vite";
import { APP_NAME } from "@foundmill/config";
import { ShowcaseConsent, type ShowcaseConsentView } from "./ShowcaseConsent";

const view: ShowcaseConsentView = {
  projectName: "Maple Bakes",
  postText: "How Maple Bakes was built. Page live on Nov 12, 2026. First follower on Nov 14, 2026.",
  link: "https://foundmill.example/p/maple-bakes/story?via=p.maple-bakes",
  networks: ["instagram", "tiktok", "x", "linkedin"],
  clips: [
    { url: "https://foundmill.example/clips/page-live.mp4", caption: "Nov 12: page live" },
    { url: "https://foundmill.example/clips/first-follower.mp4", caption: "Nov 14: first follower" },
  ],
  answer: null,
  withdrawn: false,
  state: "asking",
  expiresOn: "Nov 28, 2026",
  canAnswer: true,
  canWithdraw: false,
};

/**
 * A founder's own ask about a showcase video (docs/THESIS_REVIEW.md §13 item 15): exactly what would be posted, the
 * sentence that a posted video cannot be pulled back, and the founder's own answer. Needs you, from 390 px.
 */
const meta = {
  title: "Share/ShowcaseConsent",
  component: ShowcaseConsent,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The video, the post's words, the link and the networks, exactly as they would be posted; then “You can withdraw any time before it's posted. Once Foundmill posts it, it can't be pulled back from those networks.” Each founder answers for themselves, signed in, and sees only their own answer. One column from 390 px.",
      },
    },
  },
  args: { view, appName: APP_NAME, onAnswer: () => undefined, onWithdraw: () => undefined },
} satisfies Meta<typeof ShowcaseConsent>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Waiting for this founder's answer. */
export const Asking: Story = {};

/** At 390 px: one column, nothing wider than the screen. */
export const Phone: Story = { parameters: { viewport: { defaultViewport: "mobile1" } }, decorators: [(S) => <div style={{ width: 390 }}>{S()}</div>] };

/** This founder said yes; the others have not all answered. They can still withdraw. */
export const SaidYes: Story = { args: { view: { ...view, answer: "yes", canAnswer: false, canWithdraw: true } } };

/** Every founder said yes: still withdrawable until it is posted. */
export const Approved: Story = { args: { view: { ...view, answer: "yes", state: "approved", canAnswer: false, canWithdraw: true } } };

/** Withdrawn: the media is deleted and nothing will be posted. */
export const Withdrawn: Story = { args: { view: { ...view, answer: "yes", withdrawn: true, state: "withdrawn", clips: [], canAnswer: false } } };
