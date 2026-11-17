import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { founderTaskOf, type FounderTaskFacts } from "@foundmill/shared/founder-task";
import { PageGrid } from "../shell/PageGrid";
import { FounderTaskPanel } from "./FounderTaskPanel";

/** A 390 px phone frame that is its own container, so the panel lays itself out from its width. */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const base: FounderTaskFacts = { pagePublished: false, pageShared: false, planNoteOpen: true, outsideSignal: false, projectName: "Northwood", pitch: "Candles that smell like a walk in the woods", url: "https://foundmill.test/p/northwood?via=p.northwood", overnight: true };
const task = (f: Partial<FounderTaskFacts>) => founderTaskOf({ ...base, ...f })!;

const meta = {
  title: "Today/FounderTaskPanel",
  component: FounderTaskPanel,
  parameters: {
    docs: {
      description: {
        component: "“Your one thing today” on Today: the one task the founder can finish in minutes, its reason, one button, and what happens next. Once a task is done today it reads “Done for today.” and names the next one. With every task done, Today shows no panel.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="@container">
        <PageGrid>
          <Story />
        </PageGrid>
      </div>
    ),
  ],
  args: { span: 12, task: task({}) },
} satisfies Meta<typeof FounderTaskPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PublishPage: Story = {};
export const SharePage: Story = { args: { task: task({ pagePublished: true }) } };
export const ApprovePlan: Story = { args: { task: task({ pagePublished: true, pageShared: true }) } };
export const AskFive: Story = { args: { task: task({ pagePublished: true, pageShared: true, planNoteOpen: false }), status: "Message copied" } };
export const NoOvernightShift: Story = { name: "Without the overnight shift", args: { task: task({ overnight: false }) } };
export const DoneForToday: Story = { args: { task: task({ pagePublished: true, doneToday: ["publish_page"] }) } };
/** Every task done: `founderTaskOf` answers null and the host draws nothing. */
export const AllDone: Story = { name: "None (all done)", render: () => <p className="t-small text-secondary">Every task is done: Today shows no panel.</p> };
export const Phone390: Story = { name: "390 px", decorators: [Phone], args: { task: task({ pagePublished: true }) } };
