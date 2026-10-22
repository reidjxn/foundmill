import type { Meta, StoryObj } from "@storybook/react-vite";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { FIXTURE_TERMS } from "../guidance/fixtures";
import { Markdown } from "./Markdown";

const NOTE = [
  "**Runway is 7 months** at today's spending, and the figure is an estimate until the bank is connected.",
  "",
  "Cycle 3 finished with two cycles' worth of work: MRR rose to £4,200 (an Estimate from Stripe's own figures), and the runway forecast moved by a week.",
  "",
  "- The [runway page](/b/demo/finance/runway) has the detail.",
  "- `runway` in a code span stays code.",
  "- [[ent:11111111-1111-4111-8111-111111111111|Runway Ltd]] is a customer, not a term.",
].join("\n");

const meta = {
  title: "Data/Markdown",
  component: Markdown,
  parameters: {
    docs: {
      description: {
        component:
          "Markdown in the reading style (react-markdown + remark-gfm): entity mentions become EntityLinks, and with `terms` the first occurrence of each defined term in the note is a Term with its definition on hover (whole word, once per term, never inside a link, code or a mention; off while guidance is off).",
      },
    },
  },
  args: { children: NOTE, variant: "reading" },
  decorators: [
    (Story) => (
      <div className="surface-panel max-w-reading p-panel-pad">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Markdown>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The note as the reading pane shows it without the terms rule. */
export const Reading: Story = {};

/** With `terms`: Runway, Estimate, Cycle, MRR and Forecast each get one dotted underline, at their first mention. */
export const Terms: Story = {
  args: { terms: true },
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "on", terms: FIXTURE_TERMS }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};

/** Guidance off: the same note, no underlines (terms are tutoring, not information). */
export const TermsGuidanceOff: Story = {
  name: "Terms, guidance off",
  args: { terms: true },
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};
