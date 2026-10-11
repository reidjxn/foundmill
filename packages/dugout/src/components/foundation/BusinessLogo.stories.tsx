import type { Meta, StoryObj } from "@storybook/react-vite";
import { BusinessLogo, LOGO_SIZES } from "./BusinessLogo";
import { SAMPLE_LOGOS } from "./logo-samples";

const meta = {
  title: "Foundation/Logo",
  component: BusinessLogo,
  parameters: {
    docs: {
      description: {
        component:
          "The business's logo (DESIGN §8). A stored logo (uploaded, or picked from generated marks) is an image of its data URL on a white tile; without one, the neutral mark is a rounded square in the primary brand color with the business's initials in the computed on-primary color. Sizes 20, 24, 32, 48, 64, 96.",
      },
    },
  },
  args: { name: "Northwind Skincare", primary: "#2B6CB0", size: 48 },
  argTypes: { primary: { control: "color" }, size: { control: "select", options: LOGO_SIZES }, src: { control: "select", options: [undefined, ...Object.values(SAMPLE_LOGOS)] } },
} satisfies Meta<typeof BusinessLogo>;
export default meta;
type Story = StoryObj<typeof meta>;

/** No logo yet: the initials mark. */
export const Initials: Story = {};

/** A stored logo (a generated mark). */
export const Stored: Story = { args: { src: SAMPLE_LOGOS.stack } };

export const Sizes: Story = {
  render: (args) => (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-4">
        {LOGO_SIZES.map((s) => (
          <BusinessLogo key={s} {...args} size={s} />
        ))}
      </div>
      <div className="flex items-end gap-4">
        {LOGO_SIZES.map((s) => (
          <BusinessLogo key={s} {...args} src={SAMPLE_LOGOS.orbit} name="Ledgerly" primary="#1F6F5F" size={s} />
        ))}
      </div>
    </div>
  ),
};

/** The fallback across brand colors: letters switch between white and near-black to keep APCA Lc ≥ 75. */
export const FallbackColours: Story = {
  render: () => (
    <div className="grid grid-cols-6 gap-4">
      {[
        ["Northwind Skincare", "#2B6CB0"],
        ["Ledgerly", "#1F6F5F"],
        ["Aurora Candles", "#F5B841"],
        ["Mono", "#E8ECF1"],
        ["Ember Works", "#B23A2E"],
        ["Violet", "#6B46C1"],
        ["Tide", "#2C7A7B"],
        ["Slate Labs", "#4A5568"],
        ["Rose", "#E879C8"],
        ["Lime Studio", "#3DD68C"],
        ["Sun", "#FF8A5B"],
        ["Ink Base", "#0B0E12"],
      ].map(([name, primary]) => (
        <div key={name} className="flex flex-col items-center gap-1">
          <BusinessLogo name={name!} primary={primary!} size={96} />
          <span className="text-small text-secondary">{name}</span>
        </div>
      ))}
    </div>
  ),
};

/** On the three surfaces it meets: a panel, the ink and the brand-color top bar. */
export const OnSurfaces: Story = {
  render: () => (
    <div className="flex gap-4">
      {[
        ["bg-panel", "Panel"],
        ["bg-ink", "Ink"],
      ].map(([bg, label]) => (
        <div key={label} className={`flex items-center gap-3 rounded-panel border border-subtle p-4 ${bg}`}>
          <BusinessLogo name="Ledgerly" primary="#1F6F5F" size={32} />
          <BusinessLogo name="Ledgerly" primary="#1F6F5F" src={SAMPLE_LOGOS.orbit} size={32} />
          <BusinessLogo name="Acme" primary="#1F6F5F" src={SAMPLE_LOGOS.glyph} size={32} />
          <span className="text-small text-secondary">{label}</span>
        </div>
      ))}
      <div className="flex items-center gap-3 rounded-panel p-4" style={{ background: "#1F6F5F" }}>
        <BusinessLogo name="Ledgerly" primary="#1F6F5F" size={32} />
        <BusinessLogo name="Ledgerly" primary="#1F6F5F" src={SAMPLE_LOGOS.orbit} size={32} />
        <span className="text-small text-white">Top bar</span>
      </div>
    </div>
  ),
};

/** Anything that is not a logo data URL is ignored: the initials mark is drawn instead. */
export const RefusesOtherSources: Story = { args: { src: "https://example.com/logo.png", name: "Remote Image Co" } };
