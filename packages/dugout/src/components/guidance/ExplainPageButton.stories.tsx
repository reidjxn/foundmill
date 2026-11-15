import type { Meta, StoryObj } from "@storybook/react-vite";
import { TabBar } from "../shell/TabBar";
import { Explainer } from "./Explainer";
import { ExplainPageButton } from "./ExplainPageButton";
import { GuidanceProvider } from "./GuidanceProvider";
import { PageExplainProvider } from "./PageExplain";

const lines = {
  screenId: "finance/runway",
  purpose: "How many months your cash lasts at today's spending.",
  action: "Compare the three scenarios, then decide whether to spend more or less.",
  watchFor: "A runway under 9 months: it turns amber.",
};

const meta = {
  title: "Guidance/ExplainPageButton",
  component: ExplainPageButton,
  parameters: {
    docs: {
      description: {
        component:
          "The page's one “Explain this page” button, in the shell's tab row. It shows only after a screen's `Explainer` registered its lines with the `PageExplainProvider` above it, and only with guidance on. Opening it records the screen as read (the dot goes); Escape closes it and the focus returns to the button. No banner, nothing opens by itself.",
      },
    },
  },
  decorators: [
    (Story) => (
      <PageExplainProvider>
        <div className="h-72 w-full max-w-4xl">
          <TabBar tabs={[{ id: "overview", label: "Overview" }, { id: "runway", label: "Runway" }]} activeId="runway" trailing={<Story />} />
          <Explainer {...lines} />
        </div>
      </PageExplainProvider>
    ),
  ],
} satisfies Meta<typeof ExplainPageButton>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Unread: the dot says there is something new to read. */
export const Unread: Story = {};

export const Read: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ explainersSeen: { "finance/runway": true } }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};

export const GuidanceOff: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off" }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
};
