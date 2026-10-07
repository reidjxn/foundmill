import type { Meta, StoryObj } from "@storybook/react-vite";
import { BUSINESS_MODES } from "@foundmill/shared";
import { Home, Megaphone } from "lucide-react";
import { Breadcrumbs } from "./Breadcrumbs";
import { GameModeChip, ModeChip } from "./ModeChip";
import { RunwayChip } from "./RunwayChip";
import { FIXTURE_TODAY } from "./fixtures";

const meta = {
  title: "Shell/Chips and Breadcrumbs",
  component: ModeChip,
  parameters: { backgrounds: { value: "panel" } },
  args: { mode: "assisted" },
  argTypes: { mode: { control: "inline-radio", options: BUSINESS_MODES } },
} satisfies Meta<typeof ModeChip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BusinessMode: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      {BUSINESS_MODES.map((m) => (
        <ModeChip key={m} mode={m} onClick={() => {}} />
      ))}
      <ModeChip mode="automated" holiday />
      <GameModeChip mode="live" />
      <GameModeChip mode="personal" />
    </div>
  ),
};
export const Runway: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={14} cash={{ amountMinor: 18200000, currency: "EUR" }} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={8.5} cash={{ amountMinor: 9800000, currency: "EUR" }} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={4} cash={{ amountMinor: 4600000, currency: "EUR" }} onClick={() => {}} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={11} estimate={false} />
      <RunwayChip date={FIXTURE_TODAY} runwayMonths={null} />
    </div>
  ),
  parameters: { docs: { description: { story: "Neutral, amber under 9 months, red under 6 (DESIGN §8). Modelled runway carries an “Est.” label (DESIGN §10)." } } },
};
export const Trail: Story = {
  name: "Breadcrumbs",
  render: () => (
    <div className="flex flex-col gap-3">
      <Breadcrumbs items={[{ label: "Home", href: "#", icon: Home }, { label: "Distribution", href: "#", icon: Megaphone }, { label: "Channels", href: "#" }, { label: "Paid" }]} />
      <Breadcrumbs items={[{ label: "CRM", onClick: () => {} }, { label: "Nordic Beauty AB" }]} />
    </div>
  ),
};
