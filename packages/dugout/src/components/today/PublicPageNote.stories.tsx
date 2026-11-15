import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { PublicPageNote } from "./PublicPageNote";

/** A 390 px phone frame that is its own container, so the panel lays itself out from its width (package 2.1). */
const Phone: Decorator = (Story) => (
  <div className="@container w-phone border-x border-line">
    <Story />
  </div>
);

const meta = {
  title: "Today/PublicPageNote",
  component: PublicPageNote,
  parameters: {
    docs: { description: { component: "One quiet line on Today while the project has no public page live, pointing at Product › Public page. No count, no color, no badge." } },
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
  args: { href: "#public-page", span: 12 },
} satisfies Meta<typeof PublicPageNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Phone390: Story = { name: "390 px", decorators: [Phone], args: {} };
