import type { Meta, StoryObj } from "@storybook/react-vite";
import { TaskResult } from "./TaskResult";

const BODY = [
  "## What I found",
  "",
  "- Four of six panel members would switch to a quarterly refill under £35 (Estimate, n=6).",
  "- Two rivals already sell a refill: one at £32, one at £38 a quarter.",
  "",
  "## What I recommend",
  "",
  "Test a £34 quarterly refill on the account page before the second batch ships.",
].join("\n");

const meta = {
  title: "Agents/TaskResult",
  component: TaskResult,
  parameters: { layout: "padded" },
  args: {
    title: "Refill pricing: what rivals charge",
    bodyMd: BODY,
    sources: [
      { url: "https://example.com/refills", title: "Example Skincare: refill plans" },
      { url: "https://example.org/pricing", title: "Example Botanics: pricing" },
    ],
    simulated: false,
  },
  decorators: [(Story) => <div className="max-w-reading">{Story()}</div>],
} satisfies Meta<typeof TaskResult>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A report with its findings, a recommendation and two sources. */
export const Default: Story = {};

/** Its tools returned sample data: the notice sits above the body. */
export const Simulated: Story = { args: { simulated: true } };

/** No sources saved: the list is left out. */
export const NoSources: Story = { args: { sources: [] } };

/** The agent quoted HTML and a path into the app: both show as text, never as markup or a link. */
export const UntrustedText: Story = { args: { bodyMd: "Quoted from a page: <b>buy now</b> and [open settings](/b/x/settings). The real page is [here](https://example.com)." } };
