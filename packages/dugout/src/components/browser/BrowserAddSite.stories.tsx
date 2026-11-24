import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { APP_NAME } from "@foundmill/config";
import { BrowserAddSite, type BrowserSiteAnswer } from "./BrowserAddSite";

const starters = [
  { name: "Etsy", address: "www.etsy.com" },
  { name: "Gumroad", address: "app.gumroad.com" },
];

function Controlled(args: ComponentProps<typeof BrowserAddSite>) {
  const [address, setAddress] = useState(args.address);
  return <BrowserAddSite {...args} address={address} onAddressChange={setAddress} />;
}

/** Settings › Integrations › "Add any website": the address, the starter sites, and what the terms check found. */
const meta = {
  title: "Browser/BrowserAddSite",
  component: BrowserAddSite,
  parameters: { layout: "padded" },
  args: { starters, address: "", onAddressChange: () => undefined, onCheck: () => undefined, onConnect: () => undefined, answer: null },
  render: (args) => <Controlled {...args} />,
} satisfies Meta<typeof BrowserAddSite>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

const refused: BrowserSiteAnswer = { status: "refused", name: "Shop Co", message: "Shop Co's terms do not allow automated use of an account, so the team cannot work in it.", quote: "You may not use bots or other automated means to access your account.", termsUrl: "https://shop.example.com/terms" };
/** The terms forbid it: the reason and the line that says so. */
export const Forbidden: Story = { args: { address: "shop.example.com", answer: refused } };

/** A social network is refused before anything is read. */
export const Never: Story = { args: { address: "www.linkedin.com", answer: { status: "refused", name: "www.linkedin.com", message: "www.linkedin.com is a social network. The team does not work in it, and it cannot be added.", quote: null, termsUrl: null } } };

/** The terms do not say: the honest line, and the founder's own yes before Connect. */
export const NotConfirmed: Story = { args: { address: "quiet.example.com", answer: { status: "ask_first", name: "quiet.example.com", address: "quiet.example.com", line: `${APP_NAME} has not confirmed that quiet.example.com's terms allow this. Its terms were read and do not say either way, so you decide.`, quote: null, termsUrl: "https://quiet.example.com/terms", simulated: false, slotKey: "browser_web_1" } } };

/** The terms say it is allowed. */
export const Allowed: Story = { args: { address: "app.gumroad.com", answer: { status: "open", name: "Gumroad", address: "app.gumroad.com", line: "Gumroad's terms say automated use of your own account is allowed.", quote: "You may use software tools that work in your own account.", termsUrl: "https://gumroad.com/terms", simulated: false, slotKey: "browser_web_1" } } };

export const Checking: Story = { args: { address: "shop.example.com", checking: true } };
