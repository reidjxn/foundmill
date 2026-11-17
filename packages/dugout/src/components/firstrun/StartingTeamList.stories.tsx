import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { StartingTeamList, type StartingTeamAgent } from "./StartingTeamList";

const agent = (key: string, name: string, role: string, dept: StartingTeamAgent["dept"], model: string): StartingTeamAgent => ({ key, name, role, dept, model });

const STARTING = [
  agent("chief_of_staff", "Chief of Staff", "Runs the team beside you", "dept-5", "Opus"),
  agent("product_lead", "Product Lead", "Drafts your page and your plan", "dept-1", "Opus"),
  agent("researcher", "Researcher", "Finds and cites sources", "dept-1", "Sonnet"),
];
const LATER = [
  agent("product_researcher", "Product researcher", "Studies who it is for", "dept-1", "Sonnet"),
  agent("engineering_lead", "Engineering Lead", "Leads the build", "dept-2", "Opus"),
  agent("planner", "Planner", "Breaks the build into tasks", "dept-2", "Opus"),
  agent("frontend_engineer", "Frontend engineer", "Builds the screens", "dept-2", "Sonnet"),
  agent("distribution_strategist", "Distribution Strategist", "Scores the channels", "dept-3", "Sonnet"),
  agent("finance_lead", "Finance Lead", "Keeps the numbers", "dept-4", "Sonnet"),
];

/**
 * The starting team a new project is shown on Commit (WP-04 T4): three agents, everyone else behind "See everyone",
 * models only in Builder view. At 390 px and 1440 px, as Commit is checked.
 */
const meta = {
  title: "Guidance/Starting team",
  component: StartingTeamList,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The team a new project is shown: everyone is hired at the start, and three are listed (the Chief of Staff, the Product Lead and the Researcher). See everyone opens the full list. Models are named only in Builder view. Pure: the caller splits the team with `startingTeam`.",
      },
    },
  },
  args: { starting: STARTING, later: LATER },
} satisfies Meta<typeof StartingTeamList>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line bg-canvas p-gutter">
    <Story />
  </div>
);
const Wide: Decorator = (Story) => (
  <div className="@container mx-auto w-full max-w-reading bg-canvas p-gutter">
    <Story />
  </div>
);

export const Phone390: Story = { name: "390 px", decorators: [Phone] };
export const Wide1440: Story = { name: "1440 px", decorators: [Wide] };
export const BuilderView: Story = { name: "1440 px · Builder view", decorators: [Wide], args: { showModels: true } };
export const NobodyWaiting: Story = { name: "390 px · nobody else hired", decorators: [Phone], args: { later: [] } };
