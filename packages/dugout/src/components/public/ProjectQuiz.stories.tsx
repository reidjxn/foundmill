import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import type { PageQuizDefinition } from "@foundmill/shared/page-quiz";
import { ProjectFollowForm } from "./ProjectFollowForm";
import { ProjectPage } from "./ProjectPage";
import { ProjectQuiz } from "./ProjectQuiz";

const QUIZ: PageQuizDefinition & { slug: string; version: number } = {
  slug: "ember-roasters",
  version: 2,
  intro: "",
  types: [
    { key: "t1", name: "Cafes that restock every week", summary: "They order a box before they open on Mondays.", offer: "o1" },
    { key: "t2", name: "People buying a gift", summary: "One bag of beans, wrapped, for someone else.", offer: "o2" },
    { key: "t3", name: "Home brewers trying something new", summary: "They want to hear when a new roast is ready.", offer: "o3" },
  ],
  offers: [
    { key: "o1", title: "Weekly coffee box", detail: "Two bags of this week's roast, delivered on Mondays.", action: { kind: "link", url: "https://pay.example.com/ember/box", label: "Order a box" } },
    { key: "o2", title: "Gift bag of beans", detail: "", action: { kind: "link", url: "https://pay.example.com/ember/gift", label: "Buy a gift bag" } },
    { key: "o3", title: "Follow Ember Roasters", detail: "", action: { kind: "follow" } },
  ],
  questions: [
    { key: "q1", text: "Who is the coffee for?", answers: [{ key: "a1", text: "My cafe", type: "t1" }, { key: "a2", text: "Someone else", type: "t2" }, { key: "a3", text: "Me, at home", type: "t3" }] },
    { key: "q2", text: "How often would you want it?", answers: [{ key: "a1", text: "Every week", type: "t1" }, { key: "a2", text: "Just once", type: "t2" }, { key: "a3", text: "When something new is out", type: "t3" }] },
  ],
};

/**
 * The optional quiz on a project's public page (0105) at the two widths it is checked at. Every offer stays in view
 * under the questions; the result names the offer and points to the page's own Follow form or the founders' own link.
 */
const meta = {
  title: "Public/ProjectQuiz",
  component: ProjectQuiz,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "“Which one is for you?” on a project's public page: 2 to 4 short questions built from the project's real customers and approved by its founders, a result that says “This one is probably for you” with the matching offer, and every offer listed below whatever the result. No timer, no count of other visitors, no pressure. Native radios in a plain form, so it works without JavaScript; 44 px targets from 390 px. Server-safe.",
      },
    },
  },
  args: { quiz: QUIZ, followForm: true, action: "#" },
} satisfies Meta<typeof ProjectQuiz>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line bg-canvas p-4">
    <Story />
  </div>
);
const Desktop: Decorator = (Story) => (
  <div className="@container w-desktop bg-canvas p-8">
    <Story />
  </div>
);

export const Questions390: Story = { name: "390 px · the questions", decorators: [Phone] };
export const Result390: Story = { name: "390 px · a result", decorators: [Phone], args: { state: { status: "result", type: "t1", answers: { q1: "a1", q2: "a1" } } } };
export const ResultFollow390: Story = { name: "390 px · a result that points to Follow", decorators: [Phone], args: { state: { status: "result", type: "t3", answers: { q1: "a3", q2: "a3" } } } };
export const Unanswered390: Story = { name: "390 px · a question left out", decorators: [Phone], args: { state: { status: "error", message: "Answer every question to see which one fits.", answers: { q1: "a2" } } } };
export const NoFollowForm390: Story = { name: "390 px · the page has no Follow form", decorators: [Phone], args: { followForm: false } };
export const Preview390: Story = { name: "390 px · the console's preview", decorators: [Phone], args: { preview: true } };
export const Questions1280: Story = { name: "1280 px · the questions", decorators: [Desktop] };

/** On the page, before the Follow form, as the public route renders it. */
export const OnThePage390: StoryObj<typeof ProjectPage> = {
  name: "390 px · on the public page",
  render: () => (
    <div className="w-phone border-x border-line">
      <ProjectPage
        variant="page"
        name="Ember Roasters"
        pitch="Fresh coffee for cafes and for gifts"
        about="We roast every Monday in small batches."
        stage="live"
        brandPrimary="#a0522d"
        brandSecondary="#f4efe6"
        quiz={<ProjectQuiz quiz={QUIZ} followForm action="#" />}
        follow={<ProjectFollowForm name="Ember Roasters" slug="ember-roasters" action="#" />}
      />
    </div>
  ),
};
