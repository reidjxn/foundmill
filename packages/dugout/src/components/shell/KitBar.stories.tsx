import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowRight } from "lucide-react";
import { Button } from "../foundation/Button";
import { Chip } from "../foundation/Chip";
import { SAMPLE_LOGOS } from "../foundation/logo-samples";
import { KitBar } from "./KitBar";
import { FIXTURE_TODAY, LEDGERLY_KIT, NORTHWIND_KIT, SWITCHER_BUSINESSES } from "./fixtures";

const meta = {
  title: "Shell/Top bar",
  component: KitBar,
  parameters: { layout: "fullscreen", docs: { description: { component: "56 px glass slab in the brand color: gloss, a brand gradient from 92% to 38% over a brand-tinted near-black, a fixed specular streak, a light top edge, a kit-lift line under it and the brand's light cast onto the canvas. Left: the logo tile, the business name, back/forward, a hairline, the screen title. Then the universal search and, right: date + runway (dashed Estimate tag), the mode chip, Continue and Stop all agents — all glass, 34 px. At 1280 the search gives way first (placeholder → “Search” → icon); the name and the title step their size down before they would ever truncate." } } },
  args: {
    kit: NORTHWIND_KIT,
    logoSrc: SAMPLE_LOGOS.stack,
    businessName: "Northwind Skincare",
    screenTitle: "Distribution",
    nav: { onBack: () => {}, onForward: () => {}, canGoForward: false },
    onSearch: () => {},
    date: FIXTURE_TODAY,
    runwayMonths: 11,
    cash: { amountMinor: 12800000, currency: "EUR" },
    businessMode: "assisted",
    spendLineMinor: 5_000,
    businessCurrency: "EUR",
    gameMode: "live",
    continueButton: { state: { kind: "idle" } },
    stopAll: { onConfirm: () => new Promise<void>((r) => setTimeout(r, 800)), runningCount: 7 },
    onHome: () => {},
  },
  argTypes: { businessMode: { control: "inline-radio", options: ["augmented", "assisted", "automated"] } },
} satisfies Meta<typeof KitBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {};
export const Blocked: Story = { args: { continueButton: { state: { kind: "blocked", count: 3 } }, runwayMonths: 5.5 } };
export const Processing: Story = { args: { continueButton: { state: { kind: "processing" } } } };
export const CustomerUpdate: Story = { args: { continueButton: { state: { kind: "matchday" } } } };
export const Holiday: Story = { name: "Vacation", args: { businessMode: "automated", continueButton: { state: { kind: "holiday", until: "2026-10-21" } } } };
export const LightBrandColour: Story = {
  name: "Light brand color → dark text",
  args: { kit: { primary: "#F5B841", secondary: "#0F1318" }, businessName: "Aurora Candles", logoSrc: null, businessMode: "augmented", gameMode: "personal", runwayMonths: 8 },
};
export const Ledgerly: Story = { args: { kit: LEDGERLY_KIT, businessName: "Ledgerly", logoSrc: SAMPLE_LOGOS.orbit, screenTitle: "Finance · Runway", businessMode: "automated", spendLineMinor: null, businessCurrency: "GBP", runwayMonths: null, runwayWords: { value: "Not running out", caption: "You earn more than you spend" } } };
/** No logo yet: the initials mark in the primary, separated from the bar by its hairline. */
/** The Example frame: the neutral "Example" chip after the name, and "Start your own" in Continue's slot (its width kept). */
export const ExampleFrame: Story = {
  args: {
    businessBadge: <Chip className="shrink-0 text-kit-on-primary">Example</Chip>,
    continueSlot: (
      <Button variant="primary" iconRight={ArrowRight} className="h-kitbar-chip rounded-track min-w-continue-min" data-coachmark="start-your-own">
        Start your own
      </Button>
    ),
    continueButton: { state: { kind: "idle" }, disabled: true },
    stopAll: { onConfirm: async () => {}, className: "hidden" },
  },
};
export const WithoutLogo: Story = { name: "No logo yet → initials mark", args: { logoSrc: null } };

export const SwitchBusiness: Story = {
  name: "Switch business",
  args: { businessMenu: { businesses: SWITCHER_BUSINESSES, onOpenBusiness: () => {}, onNewBusiness: () => {}, onManageBusinesses: () => {}, onProfile: () => {} } },
  parameters: { docs: { description: { story: "The logo and name are the business switcher: a chevron after the name and the tooltip “Switch business”. It opens the founder's businesses (the current one first and checked, logos, role and Demo chips), a filter from six businesses, then Create a new business, Manage businesses, Home and Your profile." } } },
};

export const ConnectionDown: Story = {
  name: "Live connection down",
  args: { connection: { state: "reconnecting" } },
  parameters: { docs: { description: { story: "After a few seconds without the live connection, a glass chip in an amber ring says so before the date: “Reconnecting…”, or “Live updates paused” when it is not coming back by itself. It leaves as soon as the connection is live again." } } },
};
/** The minimum window: the search keeps only what fits; the title is never cut. */
export const At1280: Story = {
  name: "1280 px window",
  args: { screenTitle: "Settings · Departments", gameMode: "personal" },
  decorators: [
    (Story) => (
      <div style={{ width: 1048 }}>
        <Story />
      </div>
    ),
  ],
};
export const LongTitleAndName: Story = {
  name: "Long title and business name at 1280",
  args: { businessName: "Northwind Skincare & Apothecary Collective", screenTitle: "Retail Partnerships and Wholesale", runwayMonths: 7.5, gameMode: "personal", continueButton: { state: { kind: "blocked", count: 12 } } },
  decorators: [
    (Story) => (
      <div style={{ width: 1048 }}>
        <Story />
      </div>
    ),
  ],
};
/**
 * Ledgerly on vacation in a 1280 px window: the search is down to its icon and the bar still cannot hold everything, so
 * the chips compact one step at a time (KitBarFit) until every control is whole and the title has its room: the year
 * leaves the dates first, then the vacation caption shortens to "Until Oct 21".
 */
export const HolidayAt1280: Story = {
  name: "Vacation at 1280: the chips compact",
  args: { kit: LEDGERLY_KIT, businessName: "Ledgerly", logoSrc: null, screenTitle: "Distribution", runwayMonths: null, businessMode: "automated", gameMode: "live", continueButton: { state: { kind: "holiday", until: "2026-10-21" } } },
  decorators: [
    (Story) => (
      <div style={{ width: 1048 }}>
        <Story />
      </div>
    ),
  ],
};
