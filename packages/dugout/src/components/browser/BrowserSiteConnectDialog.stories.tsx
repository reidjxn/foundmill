import type { Meta, StoryObj } from "@storybook/react-vite";
import { APP_NAME } from "@foundmill/config";
import { BrowserSiteConnectDialog } from "./BrowserSiteConnectDialog";

/**
 * Connecting a website the team can work in: the plain words first (before the first site), then the founder's own
 * sign-in in the live view. Cancel throws the unsaved sign-in away.
 */
const meta = {
  title: "Browser/BrowserSiteConnectDialog",
  component: BrowserSiteConnectDialog,
  parameters: { layout: "centered" },
  args: { open: true, onOpenChange: () => undefined, siteName: "Linktree", askFirst: false, showIntro: true, appName: APP_NAME, stage: "intro", liveViewUrl: null, onStart: () => undefined, onDone: () => undefined, onCancel: () => undefined },
} satisfies Meta<typeof BrowserSiteConnectDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Before the first site is connected: what the team will do in the account. */
export const Intro: Story = {};

/** A site whose terms Foundmill has not confirmed: the caution is added. */
export const AskFirstSite: Story = { args: { siteName: "Carrd", askFirst: true } };

/** Not the first site: only the caution, when there is one. */
export const SecondSiteAskFirst: Story = { args: { siteName: "Carrd", askFirst: true, showIntro: false } };

/** The page itself, interactive, for the founder to sign in. The frame here points at nothing real. */
export const LiveView: Story = { args: { stage: "sign_in", liveViewUrl: "https://6080-isample0000000001.e2b.app/vnc.html" } };

/** Done did not finish: the sign-in is not complete, and the dialog stays open. */
export const NotSignedInYet: Story = { args: { stage: "sign_in", liveViewUrl: "https://6080-isample0000000001.e2b.app/vnc.html", error: "You are not signed in to Linktree yet. Finish signing in, then press Done." } };

/** The simulated mode: no page, and Done finishes it. */
export const Simulated: Story = { args: { stage: "sign_in", liveViewUrl: null } };
