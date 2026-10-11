import type { Meta, StoryObj } from "@storybook/react-vite";
import { DateFormatProvider } from "../../foundation/DateFormatProvider";
import { LEDGERLY_KIT, matchDayFixture, NORTHWIND_KIT } from "../fixtures";
import { MatchdayRoundupTable, type RoundupRow } from "../MatchdayRoundupTable";
import { JourneyStage } from "./JourneyStage";

const fx = matchDayFixture();

const meta = {
  title: "Journey/JourneyStage",
  component: JourneyStage,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Customer Update (BUILD §11.4): Who was involved → First touch → Touches → Rails → Win moment → Debrief. Frames come from a deterministic schedule of the journey record (same record, same replay). Full 54 s, Highlights 12.5 s, Instant. The Goal moment is a 1.2 s kit-color wipe with a PixiJS particle burst in kit-secondary and gold, sound off. Reduced motion renders the static summary.",
      },
    },
  },
  args: { journey: fx.journey, touches: fx.touches, customer: fx.customer, agents: fx.agents, kit: NORTHWIND_KIT, entityKinds: { [fx.journey.entityId as string]: "organisation" } },
  argTypes: { defaultSpeed: { control: "inline-radio", options: ["full", "highlights", "instant"] } },
} satisfies Meta<typeof JourneyStage>;
export default meta;
type Story = StoryObj<typeof meta>;

const frame = (children: React.ReactNode) => <div className="h-screen bg-base">{children}</div>;

export const Highlights: Story = { name: "Replay · Highlights (12.5 s)", args: { defaultSpeed: "highlights" }, render: (args) => frame(<JourneyStage {...args} />) };
export const FullMatch: Story = { name: "Replay · Full match (54 s)", args: { defaultSpeed: "full" }, render: Highlights.render };
export const Instant: Story = { name: "Instant result", args: { defaultSpeed: "instant" }, render: Highlights.render };
export const Paused: Story = { name: "Paused on Who was involved (step through)", args: { defaultSpeed: "full", autoplay: false }, render: Highlights.render };
export const SecondBrandColours: Story = { name: "Ledgerly brand colors", args: { defaultSpeed: "highlights", kit: LEDGERLY_KIT }, render: Highlights.render };
export const ReducedMotion: Story = { name: "Reduced motion (static summary)", args: { defaultSpeed: "full", overlay: "none" }, parameters: { docs: { description: { story: "Enable reduced motion in the OS (or the a11y addon) to see the static summary: Win moment, Debrief, Who was involved and Rails at once." } } }, render: Highlights.render };

const roundup: RoundupRow[] = [
  { conversionId: "r1", kind: "payment", level: "cup", customerName: "Alma Botanics", entityId: "0f7c2d1e-4b1a-4c8e-9a3b-2d5f6e7a8b9c", channelKey: "paid_ads", amountMinor: 5900, currency: "EUR", occurredAt: "2026-10-07T11:42:00.000Z", touchCount: 7 },
  { conversionId: "r2", kind: "payment", level: "cup", customerName: "Oslo Apothecary", channelKey: "influencer", amountMinor: 12900, currency: "EUR", occurredAt: "2026-10-07T14:05:00.000Z", touchCount: 11, fullMatchDay: true },
  { conversionId: "r3", kind: "activation", level: "league", customerName: "Kaj Petersen", channelKey: "email_automation", amountMinor: 0, currency: "EUR", occurredAt: "2026-10-07T09:30:00.000Z", touchCount: 4 },
  { conversionId: "r4", kind: "activation", level: "league", customerName: null, channelKey: "seo", amountMinor: 0, currency: "EUR", occurredAt: "2026-10-07T16:12:00.000Z", touchCount: 2 },
  { conversionId: "r5", kind: "signup", level: "friendly", customerName: "Linnea Haug", channelKey: "social", amountMinor: 0, currency: "EUR", occurredAt: "2026-10-07T08:10:00.000Z", touchCount: 3 },
  { conversionId: "r6", kind: "signup", level: "friendly", customerName: "Birch & Fern", channelKey: "content", amountMinor: 0, currency: "EUR", occurredAt: "2026-10-07T18:44:00.000Z", touchCount: 1, replayAvailable: false },
];

const roundupView = () => (
  <div className="p-gutter">
    <div className="surface-panel w-[960px] overflow-hidden">
      <MatchdayRoundupTable rows={roundup} day="2026-10-07" onOpenReplay={() => {}} />
    </div>
  </div>
);

export const Roundup: Story = {
  name: "Customer update round-up table",
  render: roundupView,
};

/** The signed-in person's choice (Settings › Preferences): the Time column on a 24-hour clock, the day in ISO. */
export const RoundupIso24h: Story = {
  name: "Customer update round-up · ISO, 24-hour",
  render: () => <DateFormatProvider value={{ date: "iso", time: "24h" }}>{roundupView()}</DateFormatProvider>,
};

export const PausedDayFirst24h: Story = {
  name: "Paused · Day first, 24-hour",
  args: { defaultSpeed: "full", autoplay: false },
  render: (args) => <DateFormatProvider value={{ date: "day_first", time: "24h" }}>{frame(<JourneyStage {...args} />)}</DateFormatProvider>,
};
