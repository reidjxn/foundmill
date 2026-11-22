import type { Meta, StoryObj } from "@storybook/react-vite";
import { HardGateNote } from "./HardGateNote";

// A one-pixel page standing in for the screenshot.
const PAGE = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'><rect width='640' height='360' fill='%23222'/><text x='24' y='48' fill='%23ddd' font-size='20'>Checkout: Pro plan, $29.00</text></svg>";

/** Under the instructions of a hard-gate note: the page as it was before the press. Nothing here presses anything. */
const meta = {
  title: "Browser/HardGateNote",
  component: HardGateNote,
  parameters: { layout: "padded" },
  args: { siteName: "Carrd", label: "Buy now", address: "https://carrd.co/checkout", amount: "$29.00", screenshotDataUrl: PAGE, onOpenSite: () => undefined },
} satisfies Meta<typeof HardGateNote>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithAmount: Story = {};
export const NoAmount: Story = { args: { amount: null, label: "Delete site" } };
export const NoPicture: Story = { args: { screenshotDataUrl: null } };
export const Loading: Story = { args: { screenshotDataUrl: null, loading: true } };
export const Simulated: Story = { args: { simulated: true } };
