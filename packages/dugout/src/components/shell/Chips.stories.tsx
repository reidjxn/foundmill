import type { Meta, StoryObj } from "@storybook/react-vite";
import { BUSINESS_MODES } from "@foundmill/shared";
import { Home, Megaphone } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { ConnectionChip } from "./ConnectionChip";
import { GameModeChip, ModeChip } from "./ModeChip";
import { kitStyle } from "./KitBar";
import { RunwayChip } from "./RunwayChip";
import { FIXTURE_TODAY, NORTHWIND_KIT } from "./fixtures";

const meta = {
  title: "Shell/Chips and Breadcrumbs",
  component: ModeChip,
  parameters: { docs: { description: { component: "The top bar's chips are glass on the brand slab (black at 30% over a 14 px blur, an 11% ring, a 10% top light; 34 px, 8 px radius): icon + word, so a mode never rests on color. The breadcrumbs trail sits under the tab bar." } } },
  args: { mode: "assisted" },
  decorators: [
    (Story) => (
      <div className="kitbar-slab rounded-md p-3 text-kit-on-primary" style={kitStyle(NORTHWIND_KIT)}>
        <Story />
      </div>
    ),
  ],
  argTypes: { mode: { control: "inline-radio", options: BUSINESS_MODES } },
} satisfies Meta<typeof ModeChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BusinessMode: Story = {
  name: "What the team can do",
  render: () => (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {BUSINESS_MODES.map((m) => (
          <ModeChip key={m} mode={m} spendLineMinor={m === "automated" ? 100_000 : 5_000} currency="GBP" onClick={() => {}} />
        ))}
        <ModeChip mode="assisted" spendLineMinor={0} currency="GBP" />
        <ModeChip mode="assisted" spendLineMinor={null} currency="GBP" />
        <ModeChip mode="assisted" holiday spendLineMinor={5_000} currency="GBP" />
        <GameModeChip mode="live" />
        <GameModeChip mode="personal" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ModeChip mode="assisted" spendLineMinor={5_000} currency="USD" />
        <ModeChip mode="automated" spendLineMinor={100_000} currency="SEK" />
        <ModeChip mode="automated" spendLineMinor={null} currency="EUR" />
      </div>
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "The mode chip says the setting in plain words, in the business's currency with its narrow symbol: “Asks before spending over £50”, “Asks before any spending” (line 0), “Asks before spending over each agent's limit” (no line), “Asks before acting”, “Decides alone, asks over £1,000”, and on vacation the vacation's words with what comes back in the tooltip. The tooltip ends with “Change it in Settings › What the team can do.”",
      },
    },
  },
};

/** The short words the chip keeps once the top bar tightens (KitBarFit `chips-brief`). */
export const BusinessModeBrief: Story = {
  name: "What the team can do, short",
  render: () => (
    <div className="flex flex-wrap items-center gap-2" data-compact="chips-brief">
      <ModeChip mode="assisted" spendLineMinor={5_000} currency="GBP" />
      <ModeChip mode="assisted" spendLineMinor={0} currency="GBP" />
      <ModeChip mode="augmented" spendLineMinor={5_000} currency="GBP" />
      <ModeChip mode="automated" spendLineMinor={100_000} currency="GBP" />
      <ModeChip mode="automated" spendLineMinor={1_000_000} currency="SEK" />
    </div>
  ),
};
export const Connection: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <ConnectionChip state="reconnecting" />
      <ConnectionChip state="paused" detail="Live updates are paused. Screens refresh every 30 s until they resume." />
      {/* Builder view off: a long outage (over 30 s) earns this one quiet word; a short reconnect shows nothing. */}
      <ConnectionChip state="late" />
    </div>
  ),
  parameters: { docs: { description: { story: "The live connection is down: icon + word in an amber ring, announced politely. Nothing moves by itself." } } },
};
export const Runway: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={14} cash={{ amountMinor: 18200000, currency: "EUR" }} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={8.5} cash={{ amountMinor: 9800000, currency: "EUR" }} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={4} cash={{ amountMinor: 4600000, currency: "EUR" }} onClick={() => {}} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={11} estimate={false} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={null} words={{ value: "Not running out", caption: "You earn more than you spend" }} cash={{ amountMinor: 3300000, currency: "GBP" }} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={null} words={{ value: "Not known yet", caption: "Not enough data yet: connect your bank" }} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={null} words={{ value: "Not known yet", caption: "Not enough data yet: needs three months of bank history" }} />
    </div>
  ),
  parameters: { docs: { description: { story: "Neutral, amber under 9 months, red under 6, with a warning icon and a tinted ring (DESIGN §8). Modeled runway carries the dashed “Estimate” tag (DESIGN §10). Without a figure it says what Home's tiles say, from the app's shared runway wording: “Not running out” when cash-flow positive, “Not known yet” without a bank or with too little history, the reason as its tooltip." } } },
};
export const Trail: Story = {
  name: "Breadcrumbs",
  decorators: [
    (Story) => (
      <div className="bg-canvas p-3">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Home", href: "#", icon: Home }, { label: "Distribution", href: "#", icon: Megaphone }, { label: "Channels", href: "#" }, { label: "Paid" }]} />
      <Breadcrumbs items={[{ label: "CRM", onClick: () => {} }, { label: "Nordic Beauty AB" }]} />
    </div>
  ),
};
