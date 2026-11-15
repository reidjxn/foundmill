import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PersonPage } from "./PersonPage";

/**
 * A person's public profile at the two widths it is checked at: 390 px (a phone, the smallest the outer product
 * supports) and 1280 px. The frame sets the width; the page lays itself out from its own width (a container query), as
 * it does in the edit screen's phone preview.
 */
const meta = {
  title: "Public/PersonPage",
  component: PersonPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A person's public profile at `/u/<handle>` (docs/THESIS_REVIEW.md package 2.3): an initials avatar, the name, the headline, the place, one line about people only when the person chose one (“Building on my own” shows nothing), about in the reading measure, “Good at” and “Wants to learn” chips, and the person's public project pages as cards. No mark of the product: that belongs to a project's page, never to a person. Plain text only, every string a text node. Server-safe.",
      },
    },
  },
  args: {
    name: "Maya Okafor",
    headline: "Baker who wants to sell what she makes",
    about: "I bake sourdough in a small kitchen and sell it to neighbors on Saturdays.\n\nNow I am turning it into a bread subscription that people can order online.",
    strengths: ["Baking", "Talking to people", "Organizing"],
    wantsToLearn: ["Selling", "Pricing", "Building websites"],
    lookingFor: "on_my_own",
    place: "Leeds, UK",
    projects: [{ slug: "rise-bread", name: "Rise Bread", pitch: "Fresh sourdough at your door every Saturday" }],
    variant: "preview",
  },
} satisfies Meta<typeof PersonPage>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="w-phone border-x border-line">
    <Story />
  </div>
);
const Desktop: Decorator = (Story) => (
  <div className="w-desktop">
    <Story />
  </div>
);

/** Building on my own: complete as it is, with nothing about people on the page. */
export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Desktop1280: Story = { name: "1280 px", decorators: [Desktop] };
export const OpenToPeople390: Story = { name: "390 px · open to building with people", decorators: [Phone], args: { lookingFor: "open_to_people" } };
export const LookingForCofounder1280: Story = { name: "1280 px · looking for a cofounder", decorators: [Desktop], args: { lookingFor: "looking_for_cofounder" } };
export const LookingToJoin390: Story = { name: "390 px · looking to join a project, no project yet", decorators: [Phone], args: { lookingFor: "looking_to_join", projects: [] } };
export const Minimal390: Story = {
  name: "390 px · only a name",
  decorators: [Phone],
  args: { headline: "", about: "", strengths: [], wantsToLearn: [], place: "", projects: [] },
};
export const LongWords1280: Story = {
  name: "1280 px · long words wrap",
  decorators: [Desktop],
  args: {
    name: "Bartholomew Supercalifragilistic-Expialidocious",
    headline: "Antidisestablishmentarianism-proof bookkeeping for independent makers",
    strengths: ["Accounting and bookkeeping", "Spreadsheets", "Explaining numbers simply"],
    projects: [
      { slug: "ledger-light", name: "Ledger Light", pitch: "Bookkeeping that a maker can do in ten minutes a week" },
      { slug: "studio-sums", name: "Studio Sums", pitch: "Pricing help for small studios" },
    ],
  },
};
