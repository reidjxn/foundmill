import type { Meta, StoryObj } from "@storybook/react-vite";
import { GuidanceProvider } from "./GuidanceProvider";
import { LearnLinkProvider } from "./LearnLink";
import { Term } from "./Term";
import { FIXTURE_TERMS } from "./fixtures";

const meta = {
  title: "Guidance/Term",
  component: Term,
  parameters: {
    docs: {
      description: {
        component:
          "An inline defined word (UX plan §6.2). The text keeps its own color with a 1 px **dotted** underline at 40 % (the entity link's geometry; dotted = something to learn, dashed = not measured). Hover or focus opens the definition card after 300 ms: the word in display-sm, one plain sentence, an optional “In this business” fact row, the longer note, and a ghost “Learn more”. Enter pins the card so the link is reachable; Escape closes it. Guidance off: plain text, unless `always`.",
      },
    },
  },
  args: { id: "runway" },
  decorators: [
    (Story) => (
      <LearnLinkProvider resolve={(learn) => (/^https?:/.test(learn) ? learn : `#${learn}`)}>
        <GuidanceProvider value={{ terms: FIXTURE_TERMS }}>
          <div className="surface-panel w-128 p-4 text-body text-primary">
            <Story />
          </div>
        </GuidanceProvider>
      </LearnLinkProvider>
    ),
  ],
} satisfies Meta<typeof Term>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The word on its own: hover, or Tab to it and press Enter. */
export const Default: Story = {};

/** In a sentence, with a lowercase display override and the business's own figure in the card. */
export const InASentence: Story = {
  name: "In a sentence, with a fact",
  render: () => (
    <p className="text-secondary">
      Your <Term id="runway" fact="£18,400 · 7 months">runway</Term> is 7 months. Each <Term id="cycle">round of work</Term> costs about £12 <Term id="estimate" always>(Estimate)</Term>.
    </p>
  ),
};

/** Panel titles, tile captions and column heads carry the same word. */
export const InATitle: Story = {
  name: "In a panel title and a data label",
  render: () => (
    <div className="flex flex-col gap-3">
      <h2 className="t-title">
        <Term id="mrr">MRR</Term> and <Term id="runway">runway</Term>
      </h2>
      <span className="t-data">
        <Term id="runway" />
      </span>
    </div>
  ),
};

/** Guidance off: the words are plain text. Estimate keeps its definition because it is information, not tutoring. */
export const GuidanceOff: Story = {
  decorators: [
    (Story) => (
      <GuidanceProvider value={{ guidance: "off", terms: FIXTURE_TERMS }}>
        <Story />
      </GuidanceProvider>
    ),
  ],
  render: () => (
    <p className="text-secondary">
      Your <Term id="runway">runway</Term> is 7 months <Term id="estimate" always>(Estimate)</Term>.
    </p>
  ),
};

/** An id the map does not hold renders its children as plain text; an inline definition fills the gap. */
export const UnknownAndInline: Story = {
  name: "Unknown id and an inline definition",
  render: () => (
    <p className="text-secondary">
      <Term id="not-in-the-map">A plain word</Term> · <Term id="local" definition={{ id: "local", word: "Chapter", short: "A quarter of the business's year, as the Journey shows it." }} />
    </p>
  ),
};
