import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ChiefQuestion } from "@foundmill/shared";
import { EntityLinkProvider } from "../data/EntityLink";
import { Avatar } from "../foundation/Avatar";
import { PageExplainProvider } from "../guidance/PageExplain";
import { Explainer } from "../guidance/Explainer";
import { ExplainPageButton } from "../guidance/ExplainPageButton";
import { GuidanceProvider } from "../guidance/GuidanceProvider";
import { AskChiefOfStaff, type AskChiefAnswer, type AskChiefOfStaffProps } from "./AskChiefOfStaff";
import { TabBar } from "./TabBar";

const AGENT = "11111111-1111-4111-8111-111111111111";

const ANSWERS: Record<ChiefQuestion, string> = {
  happening: `[[ent:${AGENT}|Juno Reyes]] is working on “Set up card payments”. This week the team finished 6 pieces of work, 4 of them for “Online booking”. Your goal is “Get the first 10 paying customers by Dec 19”. 4 of 10 so far, 40 days left: on pace (Forecast).`,
  blocking: `2 notes wait for you in Needs you. The first is “Which channel first?”, from [[ent:${AGENT}|Juno Reyes]]. One holds Continue until you answer.`,
  why: "Today is the front door: your goal, what needs you, the week's plan and the business's health in one place. 2 notes wait for you in Needs you.",
};

const avatar = (size: number) => <Avatar size={size} name="Ines Park" agent={{ seed: "ines", dept: "dept-1" }} />;

const meta = {
  title: "Shell/AskChiefOfStaff",
  component: AskChiefOfStaff,
  parameters: {
    docs: {
      description: {
        component:
          "The one “Ask <Chief of Staff>” control on every business page, at the right end of the tab row beside “Explain this page”. Its popover offers three starter questions (“What's happening?”, “What's blocking us?”, “Why am I seeing this?”) and “Ask something else…”. An answer is the Chief of Staff speaking: avatar, name, two to four plain sentences from the same facts as Today (no model call; entity mentions render as EntityLinks; a projected number keeps its Forecast label), and “Continue in chat”. Arrow keys move through the questions, Escape closes and the focus returns to the button.",
      },
    },
  },
  args: { name: "Ines", renderAvatar: avatar, answer: null, onContinue: () => undefined, onAskElse: () => undefined },
  decorators: [
    (Story) => (
      <EntityLinkProvider value={{}}>
        <div className="h-96 w-full max-w-4xl">
          <TabBar tabs={[{ id: "today", label: "Today" }, { id: "details", label: "Details" }]} activeId="today" trailing={<Story />} />
        </div>
      </EntityLinkProvider>
    ),
  ],
} satisfies Meta<typeof AskChiefOfStaff>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Stateful: picking a question loads, then answers (like the app, without the network). */
function Live(props: AskChiefOfStaffProps & { slow?: boolean; fail?: boolean }) {
  const [q, setQ] = useState<ChiefQuestion | null>(null);
  const [tries, setTries] = useState(0);
  const answer: AskChiefAnswer | null = q === null ? null : props.slow ? { status: "loading" } : props.fail && tries === 0 ? { status: "error" } : { status: "ready", text: ANSWERS[q] };
  return <AskChiefOfStaff {...props} answer={answer} onQuestionChange={setQ} onRetry={() => setTries((n) => n + 1)} />;
}

/** Closed: the button with the avatar and the name. */
export const Closed: Story = {};

/** Open on the menu of questions. */
export const Menu: Story = { args: { defaultOpen: true } };

/** Try it: pick a question and read the answer. */
export const Interactive: Story = { render: (args) => <Live {...args} /> };

/** The answer is still being worked out: a skeleton holds its place. */
export const Loading: Story = { render: (args) => <Live {...args} defaultOpen slow /> };

/** The first try fails: the message and Try again. */
export const Failed: Story = { render: (args) => <Live {...args} defaultOpen fail /> };

/** Beside “Explain this page”: both live at the end of the tab row. */
export const BesideExplainThisPage: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ explainersSeen: { home: true } }}>
        <PageExplainProvider>
          <div className="flex w-full max-w-4xl items-center justify-end gap-2">
            <Story />
            <ExplainPageButton />
          </div>
          <Explainer screenId="home" purpose="Your business at a glance." action="Read the notes in Needs you." watchFor="A note that holds Continue." />
        </PageExplainProvider>
      </GuidanceProvider>
    ),
  ],
};
