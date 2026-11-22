import type { Meta, StoryObj } from "@storybook/react-vite";
import { BrowserSitesList, type BrowserSiteRow } from "./BrowserSitesList";

const sites: BrowserSiteRow[] = [
  { connectorKey: "browser_carrd", siteKey: "carrd", name: "Carrd", askFirst: true, status: "not_connected" },
  { connectorKey: "browser_linktree", siteKey: "linktree", name: "Linktree", askFirst: true, status: "connected" },
  { connectorKey: "browser_wave", siteKey: "wave", name: "Wave", askFirst: false, status: "expired" },
];

/** Settings › Integrations › "Add a website the team can work in". */
const meta = {
  title: "Browser/BrowserSitesList",
  component: BrowserSitesList,
  parameters: { layout: "padded" },
  args: { sites, canEdit: true, onConnect: () => undefined, onDisconnect: () => undefined },
} satisfies Meta<typeof BrowserSitesList>;
export default meta;
type Story = StoryObj<typeof meta>;

/** One not connected, one signed in, one the site signed out. */
export const Mixed: Story = {};

/** A reader who cannot administer integrations sees the state and no buttons. */
export const ReadOnly: Story = { args: { canEdit: false } };
