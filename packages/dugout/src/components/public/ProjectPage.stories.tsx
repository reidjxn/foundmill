import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { APP_NAME } from "@foundmill/config";
import { builtOnWords } from "@foundmill/shared/project-page";
import { BookingBlock } from "../booking/BookingBlock";
import { BOOKING_SERVICES } from "../booking/fixtures";
import { ProjectFollowForm } from "./ProjectFollowForm";
import { ProjectPage } from "./ProjectPage";

const BUILT_ON = builtOnWords(APP_NAME);

/**
 * The public page at the two widths it is checked at: 390 px (a phone, the smallest the outer product supports) and
 * 1280 px. The frame sets the width; the page lays itself out from its own width (a container query), as it does in
 * the console's phone preview.
 */
const meta = {
  title: "Public/ProjectPage",
  component: ProjectPage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "A project's public page at `/p/<slug>` (docs/THESIS_REVIEW.md package 1.1): the logo and name, the one-line pitch as the headline, about in the reading measure, who it is for, the stage, who built it when the founders chose to say, the publish date and, at the foot, the small “Built on Foundmill” mark (a quiet link for a visitor, plain words for a signed-in member, nothing on a paid plan). Brand colors are accents only. Plain text only, every string a text node. Server-safe.",
      },
    },
  },
  args: {
    name: "Northwind Skincare",
    pitch: "Gentle skincare for sensitive skin, made in small batches",
    about:
      "We make three products and make them well: a cleanser, a moisturizer and a balm, each with six ingredients or fewer.\n\nEvery batch is mixed by hand and tested on our own skin first. We started because nothing on the shelf worked for us.",
    forWhom: "People with sensitive or reactive skin who are tired of long ingredient lists.",
    stage: "building",
    publishedAt: new Date(2026, 9, 7, 12),
    brandPrimary: "#2f7d6b",
    brandSecondary: "#f4efe6",
    logo: null,
    founderNames: ["Maya", "Sam"],
    variant: "preview",
  },
} satisfies Meta<typeof ProjectPage>;
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

export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Desktop1280: Story = { name: "1280 px", decorators: [Desktop] };
export const OneFounder390: Story = { name: "390 px · one founder, idea stage", decorators: [Phone], args: { founderNames: ["Maya"], stage: "idea" } };
export const Minimal390: Story = {
  name: "390 px · nothing optional",
  decorators: [Phone],
  args: { forWhom: "", founderNames: [], publishedAt: null, stage: "live", about: "Bike repairs at your door, booked in a minute." },
};
export const LongWords1280: Story = {
  name: "1280 px · long words wrap",
  decorators: [Desktop],
  args: { name: "Supercalifragilisticexpialidocious Studio", pitch: "Antidisestablishmentarianism-proof bookkeeping for independent makers and small studios everywhere", stage: "live" },
};
/** Package 1.6: the "Follow" form under what the founders wrote, as the public route renders it. */
export const WithFollow390: Story = {
  name: "390 px · with the follow form",
  decorators: [Phone],
  args: { variant: "page", follow: <ProjectFollowForm name="Northwind Skincare" slug="northwind-skincare" action="#" /> },
};
/** Foundmill's own booking: the block sits above the follow form. */
export const WithBooking390: Story = {
  name: "390 px · with booking and the follow form",
  decorators: [Phone],
  args: { variant: "page", booking: <BookingBlock services={BOOKING_SERVICES} href="#book" />, follow: <ProjectFollowForm name="Northwind Skincare" slug="northwind-skincare" action="#" /> },
};
export const WithFollowDone390: Story = {
  name: "390 px · followed",
  decorators: [Phone],
  args: { variant: "page", follow: <ProjectFollowForm name="Northwind Skincare" state={{ status: "done" }} /> },
};
/** The console's preview draws the form disabled. */
export const MarkForMember390: Story = {
  name: "390 px · the mark for a signed-in member (plain words, no link)",
  decorators: [Phone],
  args: { mark: "member" },
};
export const PaidPlanNoMark390: Story = {
  name: "390 px · a paid plan (no mark, no foot)",
  decorators: [Phone],
  args: { mark: "none" },
};
export const WithFollowDoneBuiltOn390: Story = {
  name: "390 px · after a visitor follows a free project",
  decorators: [Phone],
  args: {
    variant: "page",
    follow: <ProjectFollowForm name="Northwind Skincare" state={{ status: "done" }} builtOn={{ line: BUILT_ON.afterFollow("Northwind Skincare"), linkLabel: BUILT_ON.afterFollowLink, href: "#" }} />,
  },
};
export const WithFollowPreview1280: Story = {
  name: "1280 px · the follow form in the preview",
  decorators: [Desktop],
  args: { follow: <ProjectFollowForm name="Northwind Skincare" preview /> },
};
export const WithOfferPriceAndButton390: Story = {
  name: "390 px · what you get, a price, one button and a way to ask",
  decorators: [Phone],
  args: { offer: "A visit to your door and a fix on the spot.", price: "From $25", cta: { label: "Book a visit", url: "https://cal.com/maya/30min" }, askAddress: "maya-bikes@mail.example.com" },
};
