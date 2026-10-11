import type { Meta, StoryObj } from "@storybook/react-vite";
import { ConceptCard } from "../journey/concept/ConceptCard";
import { conceptFixtures } from "../journey/fixtures";
import { Button } from "../foundation/Button";
import { Square } from "lucide-react";
import {
  DraftingByline,
  DraftingCardFrame,
  DraftingLockedNote,
  DraftingSkeleton,
  JustInTag,
  landedCardClass,
} from "./DraftingCard";
import { StreamingText } from "./StreamingText";
import { ISOLDE, MARLOW, PIKE, TEODOR } from "./fixtures";

const concepts = conceptFixtures();

const meta = {
  title: "Conversation/DraftingCard",
  component: DraftingCardFrame,
  parameters: {
    docs: {
      description: {
        component:
          'The streaming card frame for the Ideation grid (SPEC "Skeleton and streaming"): queued (a skeleton named for its drafter and its place), drafting (a live edge and a traveling light in the drafter\'s color, the pitch streaming, actions locked), landed (rises, a lit kit-lift edge that settles, "Just in"). For a ConceptCard, pass landedCardClass() as its className.',
      },
    },
  },
  args: { state: "drafting", drafter: MARLOW },
} satisfies Meta<typeof DraftingCardFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The grid mid-run: a landed card ("Just in"), one drafting, two queued. */
export const Grid: Story = {
  render: () => (
    <div className="flex flex-wrap items-start gap-gutter">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-small text-tertiary">
          <JustInTag /> Drafted by Pike · 11 s · 588 tokens
        </div>
        <ConceptCard concept={concepts[0]!} className={landedCardClass({ justIn: true })} />
      </div>
      <DraftingCardFrame state="drafting" drafter={MARLOW} name="Shelfproof" className="w-80">
        <div className="flex flex-col gap-3 p-3.5">
          <div className="flex items-center gap-3">
            <span className="grid size-12 place-items-center rounded-md bg-surface-3 font-display text-display-sm text-primary">
              SP
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="t-display-sm text-primary">Shelfproof</span>
              <span className="text-small text-tertiary">B2B service</span>
            </div>
          </div>
          <p className="text-body text-primary">
            <StreamingText
              text="Stability and patch-test data as a service for indie skincare brands that want a pharmacy listing, priced per product line"
              open
              tone="dept-7"
            />
          </p>
          <DraftingByline state="drafting" drafter={MARLOW} meta="5 of 10 · 384 tokens" />
        </div>
        <div className="flex items-center gap-2 border-t border-line-faint px-2.5 py-2">
          <Button variant="ghost" size="sm" icon={Square}>
            Stop this card
          </Button>
          <DraftingLockedNote className="ml-auto" />
        </div>
      </DraftingCardFrame>
      <DraftingCardFrame state="queued" drafter={TEODOR} name="Concept 4" className="w-80">
        <DraftingSkeleton />
        <div className="flex flex-col gap-2 p-3.5">
          <DraftingByline state="queued" drafter={TEODOR} meta="next · #4" />
          <span className="text-small text-tertiary">
            Starts when Teodor is free, about 6 s (Estimate)
          </span>
        </div>
      </DraftingCardFrame>
      <DraftingCardFrame state="queued" drafter={ISOLDE} name="Concept 5" className="w-80">
        <DraftingSkeleton attributes={6} />
        <div className="flex flex-col gap-2 p-3.5">
          <DraftingByline state="queued" drafter={ISOLDE} meta="#5" />
          <span className="text-small text-tertiary">Starts after Isolde's current card</span>
        </div>
      </DraftingCardFrame>
    </div>
  ),
};

/** The landed frame on its own content. */
export const Landed: Story = {
  render: () => (
    <DraftingCardFrame state="landed" justIn drafter={PIKE} name="Northwind" className="max-w-96">
      <div className="flex flex-col gap-2 p-3.5">
        <div className="flex items-center gap-2">
          <span className="t-display-sm text-primary">Northwind</span>
          <JustInTag />
        </div>
        <p className="text-body text-primary">
          A short skincare routine made without the twelve most common irritants, with every batch's
          test results published online.
        </p>
        <DraftingByline state="landed" drafter={PIKE} meta="11 s · 588 tokens" />
      </div>
    </DraftingCardFrame>
  ),
};
