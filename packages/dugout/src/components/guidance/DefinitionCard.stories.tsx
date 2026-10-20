import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../foundation/Button";
import { DefinitionCard } from "./DefinitionCard";
import { LearnLinkProvider } from "./LearnLink";
import { FIXTURE_TERMS } from "./fixtures";

const meta = {
  title: "Guidance/DefinitionCard",
  component: DefinitionCard,
  parameters: {
    docs: {
      description: {
        component:
          "The definition surface behind Term, InfoTip and the Estimate chip: a HoverCard (surface-popover, 320 px) with the word in display-sm, the short line in body, an optional fact row, the longer note in small and a ghost “Learn more” with an arrow. It opens 300 ms after hover or focus and **persists on Enter** (focus moves to Learn more, Escape returns it), the one place a link is allowed in a hover surface (UX plan §6.4).",
      },
    },
  },
  args: {
    word: FIXTURE_TERMS.runway!.word,
    short: FIXTURE_TERMS.runway!.short,
    long: FIXTURE_TERMS.runway!.long,
    learn: FIXTURE_TERMS.runway!.learn,
    fact: "£18,400 · 7 months",
    children: <Button variant="ghost">Hover or press Enter</Button>,
  },
  decorators: [
    (Story) => (
      <LearnLinkProvider resolve={(learn) => (/^https?:/.test(learn) ? learn : `#${learn}`)}>
        <div className="flex h-64 items-start p-4">
          <Story />
        </div>
      </LearnLinkProvider>
    ),
  ],
} satisfies Meta<typeof DefinitionCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {};
export const ShortOnly: Story = { name: "Short line only", args: { long: undefined, learn: undefined, fact: undefined } };
export const ExternalLink: Story = { name: "External Learn more", args: { word: "MRR", short: FIXTURE_TERMS.mrr!.short, long: undefined, fact: undefined, learn: FIXTURE_TERMS.mrr!.learn } };
