import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../foundation/Button";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { Panel } from "../shell/Panel";
import { PageGrid } from "../shell/PageGrid";
import { Callout, Coachmark, type CoachmarkStep } from "./Coachmark";

const steps: CoachmarkStep[] = [
  { targetId: "story-journey", title: "Your story on one line", body: "Revenue, customers and milestones on one time axis; the dashed part is a forecast." },
  { targetId: "story-status", title: "Six numbers that matter", body: "Cash, runway, revenue, customers, team health and your position. Each one says where it comes from." },
  { targetId: "story-continue", title: "This is how you move forward", body: "Press Continue when you have answered what needs you; the team works a cycle and reports back.", side: "left" },
];

/** A stand-in for Home: three targets a tour can point at. */
function Home({ children, paused }: { children: React.ReactNode; paused?: boolean }) {
  return (
    <div className="flex flex-col gap-gutter">
      <div className="flex items-center justify-end gap-2">
        <Button variant="primary" id="story-continue" data-coachmark-pause={paused ? "" : undefined}>
          Continue
        </Button>
      </div>
      <PageGrid flush>
        <Panel title="Journey" span={12} glow="brand" id="story-journey">
          <p className="text-body text-secondary">The ribbon.</p>
        </Panel>
        <Panel title="Status" span={6} data-coachmark="story-status">
          <p className="text-body text-secondary">Six tiles.</p>
        </Panel>
        <Panel title="Product" span={6}>
          <p className="text-body text-secondary">A department card.</p>
        </Panel>
      </PageGrid>
      {children}
    </div>
  );
}

const meta = {
  title: "Guidance/Coachmark",
  component: Coachmark,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Anchored steps for the first-visit tours: a popover (surface-popover, elev-2) beside its target, which gets the 2 px kit-lift ring; no backdrop, nothing modal. A title, one sentence, a mono 2 of 5, then Back / Next / Skip tour. Arrows move, Esc skips. Finishing or skipping marks the tour done, so it never replays. It never starts while something on the page carries data-coachmark-pause, when guidance is off, or when the tour is already done.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="p-gutter">
        <Story />
      </div>
    ),
  ],
  args: { tourId: "story-home", steps },
} satisfies Meta<typeof Coachmark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The tour starts on its own; Storybook's state is in memory, so remount the story to see it again. */
export const Tour: Story = {
  render: (args) => {
    function Demo() {
      const [done, setDone] = useState<Record<string, true>>({});
      const [outcome, setOutcome] = useState<string | null>(null);
      return (
        <GuidanceProvider value={{ toursDone: done }} actions={{ markTourDone: (id) => setDone((d) => ({ ...d, [id]: true })), resetGuidance: () => setDone({}) }}>
          <Home>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDone({})}>
                Replay the tour
              </Button>
              <span className="text-small text-tertiary" aria-live="polite">
                {outcome ? `Tour ${outcome}` : "Tour running"}
              </span>
            </div>
            <Coachmark {...args} onDone={setOutcome} />
          </Home>
        </GuidanceProvider>
      );
    }
    return <Demo />;
  },
};

/** While Continue is processing the page carries data-coachmark-pause; the tour waits and starts once it clears. */
export const WaitsWhilePaused: Story = {
  render: (args) => {
    function Demo() {
      const [paused, setPaused] = useState(true);
      return (
        <GuidanceProvider>
          <Home paused={paused}>
            <Button size="sm" onClick={() => setPaused(false)} disabled={!paused}>
              {paused ? "Finish processing" : "Processing finished"}
            </Button>
            <Coachmark {...args} />
          </Home>
        </GuidanceProvider>
      );
    }
    return <Demo />;
  },
};

/** A single-step callout under Continue the first time it is seen. */
export const FirstContinueCallout: Story = {
  render: () => (
    <GuidanceProvider>
      <Home>
        <Callout tourId="story-first-continue" targetId="story-continue" side="left" title="This is how you move forward" body="Press it when you have answered what needs you." />
      </Home>
    </GuidanceProvider>
  ),
};

/** Already done, or guidance off: nothing starts. */
export const NeverStarts: Story = {
  render: (args) => (
    <GuidanceProvider value={{ toursDone: { "story-home": true } }}>
      <Home>
        <p className="text-small text-tertiary">This tour is marked done: nothing shows.</p>
        <Coachmark {...args} />
      </Home>
    </GuidanceProvider>
  ),
};
