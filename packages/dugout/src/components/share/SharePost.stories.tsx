import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Share2 } from "lucide-react";
import { APP_NAME } from "@foundmill/config";
import { milestonePostDraft, pagePostDraft, writtenPostDraft } from "@foundmill/shared/share-drafts";
import { Button } from "../foundation/Button";
import { SharePost, type SharePostProps } from "./SharePost";

const ORIGIN = "https://foundmill.example";
const milestone = milestonePostDraft({ origin: ORIGIN, slug: "northwind-skincare", projectName: "Northwind Skincare", milestoneId: "0b9d1c1e-1111-4222-8333-444455556666", label: "Page live" });
const page = pagePostDraft({ origin: ORIGIN, slug: "northwind-skincare", projectName: "Northwind Skincare", pitch: "Refillable skincare for sensitive skin" });

/** The share panel beside a drafted post (docs/DESIGN.md §9g): one control per network, grouped by what a press really does. */
const meta = {
  title: "Share/SharePost",
  component: SharePost,
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component:
          "Tap-to-post. The draft's text (it can be changed; nothing is saved), its link, then the networks grouped honestly: “Opens ready to post”, “Opens with your link” (the text is not carried), “Copy and post in the app”, and apart from them “Send to someone”. Every control that opens a window is a real link in the button look, in a new tab. A network is named by its word with a generic icon: no logos, no brand colors. The product posts nothing; the founder presses Post in the network's own window.",
      },
    },
  },
  args: { open: true, onOpenChange: () => undefined, title: "Share “Page live”", description: "Pick where it goes. The text and the link are ready.", draft: milestone, appName: APP_NAME },
} satisfies Meta<typeof SharePost>;
export default meta;
type Story = StoryObj<typeof meta>;

/** A milestone shown on the page: the card's address, and the tall picture for the networks that take one. */
export const Milestone: Story = {};

/** The project's page, once it is live. */
export const Page: Story = { args: { title: "Share your page", draft: page } };

/** A drafted post while the page is not published: no link, so the windows that only take a link fall to a copy of the words. */
export const DraftWithoutLink: Story = {
  name: "A drafted post, no link",
  args: { title: "Share this post", draft: writtenPostDraft({ text: "Fresh batch out today. Small jars, refills from next week." }) },
};

/** A text too long for the short networks: each is shortened at a word, with the count saying so. */
export const LongText: Story = {
  name: "Long text, shortened per network",
  args: {
    title: "Share this post",
    draft: writtenPostDraft({
      text: "Northwind Skincare makes refillable skincare for sensitive skin. Every jar comes back, gets washed and goes out again, so nothing is thrown away. The first batch is small on purpose: forty jars, one cream, no perfume. Anyone who wants to try it can leave an email on the page and hear when the next batch is ready. Questions are welcome, and so is plain feedback about what would make it better for skin that reacts to almost everything.",
      page: { origin: ORIGIN, slug: "northwind-skincare", projectName: "Northwind Skincare", pitch: "Refillable skincare for sensitive skin" },
    }),
  },
};

function Opener(props: SharePostProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" icon={Share2} onClick={() => setOpen(true)}>
        Share
      </Button>
      <SharePost {...props} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** As a screen uses it: a quiet "Share" opens the panel, and focus goes back to it on close. */
export const FromAButton: Story = { name: "Opened from a button", render: (args) => <Opener {...args} /> };
