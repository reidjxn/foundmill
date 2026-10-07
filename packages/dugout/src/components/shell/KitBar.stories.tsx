import type { Meta, StoryObj } from "@storybook/react-vite";
import { KitBar } from "./KitBar";
import { FIXTURE_TODAY, LEDGERLY_KIT, NORTHWIND_KIT } from "./fixtures";

const meta = {
  title: "Shell/KitBar",
  component: KitBar,
  parameters: { layout: "fullscreen", docs: { description: { component: "56 px. Gradient from kit-primary to kit-primary darkened 14 %; text in kit-on-primary (APCA ≥ 75). Left: crest, name, back/forward. Centre: title and the 320 px search trigger. Right: date + runway, mode chip, Continue, Stop all agents." } } },
  args: {
    kit: NORTHWIND_KIT,
    crest: { seed: "northwind", monogram: "NW" },
    businessName: "Northwind Skincare",
    screenTitle: "Distribution",
    nav: { onBack: () => {}, onForward: () => {}, canGoForward: false },
    onSearch: () => {},
    date: FIXTURE_TODAY,
    runwayMonths: 11,
    cash: { amountMinor: 12800000, currency: "EUR" },
    businessMode: "assisted",
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
export const Holiday: Story = { args: { businessMode: "automated", continueButton: { state: { kind: "holiday", until: "2026-10-21" } } } };
export const LightBrandColour: Story = {
  name: "Light brand colour → dark text",
  args: { kit: { primary: "#F5B841", secondary: "#0F1318" }, businessName: "Aurora Candles", crest: { seed: "aurora", monogram: "AU" }, businessMode: "augmented", gameMode: "personal", runwayMonths: 8 },
};
export const Ledgerly: Story = { args: { kit: LEDGERLY_KIT, businessName: "Ledgerly", crest: { seed: "ledgerly", monogram: "L" }, screenTitle: "Finance · Runway", runwayMonths: null } };
