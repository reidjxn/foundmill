import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { FOLLOW_ERRORS } from "@foundmill/shared/project-page";
import { ProjectFollowForm } from "./ProjectFollowForm";

/** The "Follow" form of a public page at phone width, in each state it can show (package 1.6). */
const meta = {
  title: "Public/ProjectFollowForm",
  component: ProjectFollowForm,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "“Follow {name}” on a project's public page: an email field, a required consent box, a hidden field for programs that fill in every field, and “Follow”, with the bot check's disclosure under it (“Protected by Cloudflare Turnstile (privacy)”, on every plan). After a signup, one line and nothing else. Server-safe; apps/web passes a Server Action and the state it returns, so it works without JavaScript. Every control is at least 44 px tall.",
      },
    },
  },
  args: { name: "Northwind Skincare", slug: "northwind-skincare", action: "#" },
} satisfies Meta<typeof ProjectFollowForm>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone bg-canvas px-gutter py-6">
    <Story />
  </div>
);

export const Empty390: Story = { name: "390 px", decorators: [Phone] };
/** The bot check's disclosure under the button, the same on every plan; apps/web also passes the widget's box. */
export const BotCheck390: Story = { name: "390 px · the bot check's line", decorators: [Phone], args: { widgetRef: () => undefined } };
export const Sending390: Story = { name: "390 px · sending", decorators: [Phone], args: { pending: true } };
export const EmailError390: Story = { name: "390 px · the address is not usable", decorators: [Phone], args: { state: { status: "error", field: "email", message: FOLLOW_ERRORS.email, email: "maya@" } } };
export const ConsentError390: Story = { name: "390 px · the box is not ticked", decorators: [Phone], args: { state: { status: "error", field: "consent", message: FOLLOW_ERRORS.consent, email: "maya@example.com" } } };
export const Done390: Story = { name: "390 px · followed", decorators: [Phone], args: { state: { status: "done" } } };
export const Preview390: Story = { name: "390 px · console preview", decorators: [Phone], args: { preview: true, action: undefined } };
