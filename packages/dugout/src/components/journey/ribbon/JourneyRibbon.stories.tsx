import { useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../../foundation/Button";
import { generateJourneyFixture, NORTHWIND_KIT, RIBBON_DEPARTMENTS } from "../fixtures";
import type { ZoomLevel } from "../types";
import { JourneyRibbon, type JourneyRibbonHandle, type JourneyRibbonProps } from "./JourneyRibbon";

const meta = {
  title: "Journey/JourneyRibbon",
  component: JourneyRibbon,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The hero of Home (BUILD §11.2, DESIGN §8): a streamgraph river of agent hours per department (curveBasis, silhouette offset), the revenue line in kit-primary, signups (dots), activations (rings) and payments (gold goal markers), milestones on hairline stems, chapters along the top, a glowing Today line, the forecast cone, ghosted roadmap flags and the runway horizon. Two years of daily data render from one path build per zoom; scrolling is a translate. Wheel or drag to scroll, ⌘/Ctrl + wheel or + / − to zoom, Home for today.",
      },
    },
  },
  argTypes: { defaultZoom: { control: "inline-radio", options: ["week", "month", "quarter", "all"] } },
} satisfies Meta<typeof JourneyRibbon>;
export default meta;
type Story = StoryObj<typeof meta>;

const twoYears = generateJourneyFixture({ days: 730 });

const baseArgs: JourneyRibbonProps = {
  rows: twoYears.rows,
  departments: RIBBON_DEPARTMENTS,
  conversions: twoYears.conversions,
  milestones: twoYears.milestones,
  chapters: twoYears.chapters,
  forecast: twoYears.forecast,
  roadmap: twoYears.roadmap,
  runwayMonths: 11,
  today: twoYears.today,
  kit: NORTHWIND_KIT,
  height: 300,
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-base p-gutter" style={{ ["--kit-primary" as string]: NORTHWIND_KIT.primary, ["--kit-secondary" as string]: NORTHWIND_KIT.secondary }}>
      <div className="surface-panel overflow-hidden">
        <header className="flex h-panel-header items-center border-b border-subtle bg-panel-alt px-panel-pad">
          <h2 className="t-label">Journey · Northwind Skincare</h2>
        </header>
        {children}
      </div>
    </div>
  );
}

export const TwoYearsQuarter: Story = {
  name: "730 days · Quarter",
  args: { ...baseArgs, defaultZoom: "quarter" },
  render: (args) => (
    <Frame>
      <JourneyRibbon {...args} />
    </Frame>
  ),
};
export const TwoYearsWeek: Story = { name: "730 days · Week", args: { ...baseArgs, defaultZoom: "week" }, render: TwoYearsQuarter.render };
export const TwoYearsMonth: Story = { name: "730 days · Month", args: { ...baseArgs, defaultZoom: "month" }, render: TwoYearsQuarter.render };
export const TwoYearsAll: Story = { name: "730 days · All time", args: { ...baseArgs, defaultZoom: "all" }, render: TwoYearsQuarter.render };

export const RunwayRed: Story = {
  name: "Runway under 6 months",
  args: { ...baseArgs, defaultZoom: "quarter", runwayMonths: 4.5 },
  render: TwoYearsQuarter.render,
};

export const LiveRipples: Story = {
  name: "Live events ripple into Today",
  args: { ...baseArgs, defaultZoom: "month" },
  render: (args) => {
    const Demo = () => {
      const ref = useRef<JourneyRibbonHandle>(null);
      const [zoom, setZoom] = useState<ZoomLevel>("month");
      return (
        <Frame>
          <JourneyRibbon {...args} ref={ref} zoom={zoom} onZoomChange={setZoom} />
          <div className="flex items-center gap-2 border-t border-subtle px-panel-pad py-2">
            <Button size="sm" onClick={() => ref.current?.ripple({ kind: "signup", label: "Signup" })}>
              Signup
            </Button>
            <Button size="sm" onClick={() => ref.current?.ripple({ kind: "activation", label: "Activation" })}>
              Activation
            </Button>
            <Button size="sm" variant="gold" onClick={() => ref.current?.ripple({ kind: "payment", amountMinor: 5900, label: "Payment · Alma Botanics" })}>
              Payment
            </Button>
            <Button size="sm" variant="ghost" onClick={() => ref.current?.scrollToToday()}>
              Scroll to today
            </Button>
            <span className="ml-auto text-small text-secondary">Zoom: {zoom}</span>
          </div>
        </Frame>
      );
    };
    return <Demo />;
  },
};

export const DayOne: Story = {
  name: "Day one (ghosted plan)",
  args: baseArgs,
  render: () => {
    const Demo = () => {
      const data = useMemo(() => generateJourneyFixture({ days: 3, seed: "day-one" }), []);
      return (
        <Frame>
          <JourneyRibbon rows={data.rows} departments={RIBBON_DEPARTMENTS} conversions={[]} milestones={data.milestones.filter((m) => m.kind === "launch")} chapters={data.chapters} forecast={data.forecast} roadmap={data.roadmap} runwayMonths={14} today={data.today} kit={NORTHWIND_KIT} defaultZoom="month" />
        </Frame>
      );
    };
    return <Demo />;
  },
};

export const ReducedMotion: Story = {
  name: "Reduced motion (static, same information)",
  args: { ...baseArgs, defaultZoom: "quarter", animateIn: false, overlay: "none" },
  render: TwoYearsQuarter.render,
};
