import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { GetTheApp } from "./GetTheApp";

const IOS = "https://apps.apple.com/us/app/foundmill/id1234567890";
const ANDROID = "https://play.google.com/store/apps/details?id=com.foundmill.app";

/** Links to the native app's store pages, read from one value that stays unset until the app launches (WP-03 T9). */
const meta = {
  title: "Public/GetTheApp",
  component: GetTheApp,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "“Get the app for iPhone” and “Get the app for Android”, each at least 44 px tall. It renders nothing while the store links are unset (`NEXT_PUBLIC_STORE_LINKS`), so one value turns every prompt on or off.",
      },
    },
  },
  args: { links: { ios: IOS, android: ANDROID } },
} satisfies Meta<typeof GetTheApp>;
export default meta;
type Story = StoryObj<typeof meta>;

const Phone: Decorator = (Story) => (
  <div className="@container w-phone bg-canvas px-gutter py-6">
    <Story />
  </div>
);

export const Both390: Story = { name: "390 px", decorators: [Phone] };
export const OneStore390: Story = { name: "390 px · one store", decorators: [Phone], args: { links: { ios: null, android: ANDROID } } };
export const Unset390: Story = { name: "390 px · unset (renders nothing)", decorators: [Phone], args: { links: null } };
