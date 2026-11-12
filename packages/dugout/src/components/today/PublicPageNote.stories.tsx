import type { Meta, StoryObj } from "@storybook/react-vite";
import { PageGrid } from "../shell/PageGrid";
import { PublicPageNote } from "./PublicPageNote";

const meta = {
  title: "Today/PublicPageNote",
  component: PublicPageNote,
  parameters: {
    docs: { description: { component: "One quiet line on Today while the project has no public page live, pointing at Product › Public page. No count, no color, no badge." } },
  },
  decorators: [
    (Story) => (
      <PageGrid>
        <Story />
      </PageGrid>
    ),
  ],
  args: { href: "#public-page", span: 12 },
} satisfies Meta<typeof PublicPageNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
