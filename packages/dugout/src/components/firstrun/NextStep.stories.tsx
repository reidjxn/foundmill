import type { Meta, StoryObj } from "@storybook/react-vite";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { Panel } from "../shell/Panel";
import { PageGrid } from "../shell/PageGrid";
import { NextStep } from "./NextStep";
import { nextStepsFor, type NextStepRoutes } from "./nextSteps";

const routes: NextStepRoutes = { vision: "#vision", inboxRespond: "#inbox", board: "#board" };

const meta = {
  title: "Guidance/NextStep",
  component: NextStep,
  parameters: {
    docs: {
      description: {
        component:
          "The strip on Home that says what to do next: a data label, one to three numbered rows (a check once done), each with a ghost Go that is a router link through ShellLinkProvider. Day one is three rows; later, the one most relevant line. Rows come from `nextStepsFor(facts, routes)`. Guidance off: not rendered.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageGrid flush>
        <Panel title="Day one" span={12}>
          <Story />
        </Panel>
      </PageGrid>
    ),
  ],
  args: {
    steps: nextStepsFor({ foundationsStatus: "ready", blockingNotes: 2, unreadNotes: 2, cycleRunning: false, cycleNumber: 1, agentsWorking: 0, distributionStarted: false, firstCycleDone: false }, routes),
  },
} satisfies Meta<typeof NextStep>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Day one: read the draft, answer the two sign-off notes, press Continue. */
export const DayOne: Story = {};

/** The sign-offs answered: two rows done, the numbering unchanged. */
export const DayOneSignedOff: Story = {
  args: {
    steps: nextStepsFor({ foundationsStatus: "ready", blockingNotes: 0, unreadNotes: 0, cycleRunning: false, cycleNumber: 1, agentsWorking: 0, distributionStarted: false, firstCycleDone: false }, routes).map((s) =>
      s.id === "press-continue" ? { ...s, onGo: () => undefined } : s,
    ),
  },
};

/** After the first cycle: one line, on one row with the label. */
export const NotesNeedAnAnswer: Story = {
  args: {
    steps: nextStepsFor({ foundationsStatus: "ready", blockingNotes: 2, unreadNotes: 3, cycleRunning: false, cycleNumber: 3, agentsWorking: 0, distributionStarted: true, firstCycleDone: true }, routes),
  },
};

export const CycleRunning: Story = {
  args: {
    steps: nextStepsFor({ foundationsStatus: "ready", blockingNotes: 0, unreadNotes: 0, cycleRunning: true, cycleNumber: 3, agentsWorking: 4, distributionStarted: true, firstCycleDone: true }, routes),
  },
};

export const NothingWaiting: Story = {
  args: {
    steps: nextStepsFor({ foundationsStatus: "ready", blockingNotes: 0, unreadNotes: 0, cycleRunning: false, cycleNumber: 4, agentsWorking: 0, distributionStarted: true, firstCycleDone: true }, routes),
  },
};

/** Tighter rows for a right rail. */
export const Compact: Story = {
  args: { compact: true },
};

/** Guidance off: the strip is not rendered (the panel keeps its milestones). */
export const GuidanceOff: Story = {
  render: (args) => (
    <GuidanceProvider value={{ guidance: "off" }}>
      <NextStep {...args} />
      <p className="text-small text-tertiary">Guidance is off: no strip.</p>
    </GuidanceProvider>
  ),
};
