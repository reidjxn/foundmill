import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogoMark } from "./LogoMark";
import { Wordmark } from "./Wordmark";

/**
 * The FM monogram is for the browser favicon and the app icon only; it is never rendered in the product UI. These stories
 * exist because the favicon art derives from it. The in-product brand is the Wordmark.
 */
const meta = {
  title: "Foundation/Brand",
  component: LogoMark,
  args: { size: 32, tone: "mono", variant: "glyph" },
  argTypes: {
    tone: { control: "inline-radio", options: ["mono", "duo"] },
    variant: { control: "inline-radio", options: ["glyph", "tile"] },
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof LogoMark>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The FM monogram: `currentColor`, so it follows the text color of its container. */
export const Monogram: Story = {};

/** Glyph sizes from favicon to hero. */
export const MonogramSizes: Story = {
  render: () => (
    <div className="flex items-end gap-6 text-primary">
      {[12, 16, 24, 32, 48, 96].map((s) => (
        <LogoMark key={s} size={s} />
      ))}
      <LogoMark size={48} tone="duo" />
      <LogoMark size={48} className="text-secondary" />
    </div>
  ),
};

/** The opaque tile for launchers and dense chrome. */
export const Tile: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {[16, 24, 32, 48, 96, 180].map((s) => (
        <LogoMark key={s} size={s} variant="tile" />
      ))}
      <LogoMark size={96} variant="tile" tone="duo" />
    </div>
  ),
};

/** The wordmark at every size it is used, on the three surfaces it meets. Always alone, never beside the monogram. */
export const WordmarkSurfaces: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="surface-panel flex flex-col gap-5 rounded-panel p-6 text-primary">
        <Wordmark height={12} />
        <Wordmark height={20} />
        <Wordmark height={28} />
        <Wordmark height={40} />
      </div>
      <div className="flex items-center gap-6 rounded-panel bg-ink p-6 text-primary">
        <Wordmark height={20} label={null} />
      </div>
      <div
        className="flex items-center gap-4 rounded-panel bg-kit-primary p-6 text-kit-on-primary"
        style={{ ["--kit-primary" as string]: "#1f6f5a", ["--kit-on-primary" as string]: "#ffffff" }}
      >
        <Wordmark height={16} label={null} />
      </div>
    </div>
  ),
};

/** Lock-up with the tagline, as used on the login page. */
export const LockUp: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-3 bg-base p-8 text-primary">
      <Wordmark height={28} />
      <p className="t-body text-secondary">Build a real business with a team of AI agents.</p>
    </div>
  ),
};
