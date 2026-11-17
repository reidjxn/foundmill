import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { NeedsYouList, type NeedsYouRow } from "./NeedsYouList";

const rows: NeedsYouRow[] = [
  { id: "a", subject: "Your first goal: get 10 paying customers by Dec 19", from: "Ines Park", kindLabel: "Goal", href: "#a", quickOption: { id: "approve", label: "Approve this goal" } },
  { id: "b", subject: "Priya wants to set the LinkedIn Ads budget to £600 a week", from: "Priya Shah", kindLabel: "Request", href: "#b", quickOption: { id: "approve_request", label: "Approve" } },
  { id: "c", subject: "Which channel should go first, search or [[ent:00000000-0000-4000-8000-000000000001|Acme Ltd]]'s referral?", from: "Juno", kindLabel: "Your decision", href: "#c" },
];

/** A 390 px phone frame that is its own container, so the panel lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/NeedsYouList",
  component: NeedsYouList,
  parameters: {
    docs: {
      description: {
        component:
          "“Needs you” on Today: up to three notes from the Inbox's Needs you tab. One tap (the note's own option label) only where it answers without the plan compiler: an agent's request, a sign-off, the goal; Open for everything else. “See all” goes to the Needs you tab.",
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
  args: { items: rows, total: 5, seeAllHref: "#inbox", span: 6, onQuickAnswer: () => {} },
} satisfies Meta<typeof NeedsYouList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Three: Story = {};
export const One: Story = { args: { items: [rows[0]!], total: 1 } };
export const Empty: Story = { args: { items: [], total: 0 } };
/** Nothing here answers in one tap: every row opens in the Inbox. */
export const OpenOnly: Story = { args: { items: rows.map((r) => ({ ...r, quickOption: null })), total: 3 } };
export const Answering: Story = { args: { pendingId: "a" } };
export const HoldsContinue: Story = { args: { items: [{ id: "h", subject: "The model account is out of credit", kindLabel: "Your decision", href: "#h", holdsContinue: true }, ...rows.slice(0, 2)], total: 3 } };
export const Phone390: Story = { name: "390 px", decorators: [Phone], args: {} };
