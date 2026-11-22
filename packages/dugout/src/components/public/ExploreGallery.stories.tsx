import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { ExploreGallery } from "./ExploreGallery";

/** The gallery at the two widths it is checked at: 390 px (a phone) and 1280 px. The page lays itself out from its own width. */
const meta = {
  title: "Public/ExploreGallery",
  component: ExploreGallery,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The opt-in gallery at `/explore`: projects whose founders chose to be listed, newest first, each a card that opens the project's page (name, one-line pitch, stage, the day it went live). Brand colors are accents only. Nothing is counted or ranked. Server-safe.",
      },
    },
  },
  args: {
    startHref: "#",
    projects: [
      { slug: "northwind", name: "Northwind Skincare", pitch: "Gentle skincare for people with sensitive skin", stage: "live", brandPrimary: "#2f7d6b", brandSecondary: "#f4efe6", publishedAt: new Date(2026, 10, 14, 8) },
      { slug: "leeds-candles", name: "Leeds Candles", pitch: "Candles that smell like a walk in the woods", stage: "building", brandPrimary: "#b4532a", brandSecondary: "#f4efe6", publishedAt: new Date(2026, 10, 9, 8) },
      { slug: "tidy-books", name: "Tidy Books", pitch: "Bookkeeping for people who run a market stall", stage: "idea", brandPrimary: "#1b4fd8", brandSecondary: "#f5c400", publishedAt: new Date(2026, 10, 2, 8) },
    ],
  },
} satisfies Meta<typeof ExploreGallery>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="w-phone border-x border-line">
    <Story />
  </div>
);

export const Desktop: Story = {};
export const Phone390: Story = { decorators: [Phone] };
export const Empty: Story = { args: { projects: [] } };
