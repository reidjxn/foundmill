import type { Meta, StoryObj } from "@storybook/react-vite";
import { GoogleSignInButton } from "./GoogleSignInButton";

/**
 * Google's light-theme sign-in button, on the sign-in frame only (app/login). The "G" and the colors are Google's own,
 * per their branding guidelines; never restyle it with the product's palette.
 */
const meta = {
  title: "Foundation/GoogleSignInButton",
  component: GoogleSignInButton,
  args: { label: "Continue with Google" },
  argTypes: { label: { control: "inline-radio", options: ["Continue with Google", "Sign in with Google", "Sign up with Google"] } },
  parameters: { layout: "padded" },
} satisfies Meta<typeof GoogleSignInButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
/** Full width in a 390 px column, as on a phone. */
export const FullWidth: Story = {
  render: (args) => (
    <div style={{ width: 358 }} className="flex flex-col">
      <GoogleSignInButton {...args} />
    </div>
  ),
};
/** After the click, while the browser leaves for Google. */
export const Loading: Story = { args: { loading: true } };
export const Disabled: Story = { args: { disabled: true } };
