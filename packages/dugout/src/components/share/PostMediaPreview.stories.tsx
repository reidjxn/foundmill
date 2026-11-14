import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PostDraftMediaItem } from "@foundmill/shared/post-media";
import { PostMediaPreview } from "./PostMediaPreview";

const ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
/** A placeholder address: the story shows the layout, not a real clip. */
const URL_PATH = "/api/post-media/storybook-placeholder-token.0000";
const video: PostDraftMediaItem = { kind: "video", state: "ready", mediaId: ID, simulated: false, mime: "video/mp4", bytes: 2_400_000, durationSeconds: 5, url: URL_PATH, fileName: "northwind-skincare-video.mp4" };
const voiceover: PostDraftMediaItem = { kind: "voiceover", state: "ready", mediaId: ID, simulated: false, mime: "audio/mpeg", bytes: 60_000, durationSeconds: 5, url: URL_PATH, fileName: "northwind-skincare-voiceover.mp3" };
const connected = { videoTools: "connected", voiceTools: "connected" } as const;

/** A post draft's media in the share panel (docs/DESIGN.md §9g): a short video and a voiceover, or one honest line. */
const meta = {
  title: "Share/PostMediaPreview",
  component: PostMediaPreview,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "The short video and the voiceover the team made for a post, on the founder's own accounts. A real one shows the browser's own player and a Save link; a simulated one shows no player and says nothing was made; one waiting for the founder's OK, declined or not connected is one line of words. The video and the voiceover are two files.",
      },
    },
  },
  args: { media: { ...connected, video, voiceover } },
} satisfies Meta<typeof PostMediaPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Both made and kept: two files, each with its player and Save. */
export const Ready: Story = {};

/** A mock connector answered: nothing was made, and the line says so. */
export const Simulated: Story = { args: { media: { ...connected, video: { ...video, state: "simulated", simulated: true, url: undefined, mime: null, bytes: null }, voiceover: { ...voiceover, state: "simulated", simulated: true, url: undefined, mime: null, bytes: null } } } };

/** Waiting for the founder's OK in Needs you: it uses their own credits. */
export const Asking: Story = { name: "Waiting for your OK", args: { media: { ...connected, video: { ...video, state: "asking", url: undefined } } } };

/** Runway is not connected on the founder's own key: the post is text only. */
export const NotConnected: Story = { name: "Not connected", args: { media: { videoTools: "not_connected", voiceTools: "not_connected" } } };

/** At phone width: the player is never wider than the panel. */
export const Phone: Story = { parameters: { viewport: { defaultViewport: "mobile1" } }, args: { media: { ...connected, video } } };
