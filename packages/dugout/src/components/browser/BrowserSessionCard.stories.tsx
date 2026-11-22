import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrowserSessionCard, type BrowserSessionView } from "./BrowserSessionCard";

const session: BrowserSessionView = { siteKey: "carrd", siteName: "Carrd", liveViewUrl: "https://6080-isample0000000001.e2b.app/vnc.html", url: "https://carrd.co/dashboard", steps: 4, held: null, simulated: false };

/** "Working in <site>" on Working now: Watch, Take over, Hand back and Stop. */
const meta = {
  title: "Browser/BrowserSessionCard",
  component: BrowserSessionCard,
  parameters: { layout: "padded" },
  args: { session, canControl: true, onTakeOver: () => undefined, onHandBack: () => undefined, onStop: () => undefined },
} satisfies Meta<typeof BrowserSessionCard>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The team is working. Watch opens the page read only. */
export const Running: Story = {};

/** The founder took over: the team is paused, and Hand back gives the page back. */
export const HeldByFounder: Story = { args: { session: { ...session, held: { why: "founder", note: "The founder took over" } } } };

/** The team stopped before pressing something only the founder presses. */
export const HeldHardGate: Story = { args: { session: { ...session, steps: 7, held: { why: "hard_gate", note: 'Press "Buy now" yourself' } } } };

/** The team asked the founder to come into the site. */
export const HeldByRequest: Story = { args: { session: { ...session, held: { why: "request", note: "Carrd asked for a code. Sign in again in the page." } } } };

/** The recorded mock: nothing outside was done. */
export const Simulated: Story = { args: { session: { ...session, liveViewUrl: null, simulated: true } } };

/** A reader who may only look: no controls. */
export const WatchOnly: Story = { args: { canControl: false } };

/** A control that did not work says so. */
export const WithError: Story = { args: { error: "The hosted browser is not available here." } };
