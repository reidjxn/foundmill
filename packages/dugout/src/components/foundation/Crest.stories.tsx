import type { Meta, StoryObj } from "@storybook/react-vite";
import { CREST_SIZES, Crest } from "./Crest";

const meta = {
  title: "Foundation/Crest",
  component: Crest,
  args: { seed: "northwind", kitPrimary: "#2B6CB0", kitSecondary: "#FFFFFF", monogram: "NW", size: 48 },
  argTypes: { kitPrimary: { control: "color" }, kitSecondary: { control: "color" }, size: { control: "select", options: CREST_SIZES } },
} satisfies Meta<typeof Crest>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Sizes: Story = {
  render: (args) => (
    <div className="flex items-end gap-4">
      {CREST_SIZES.map((s) => (
        <Crest key={s} {...args} size={s} />
      ))}
    </div>
  ),
};
export const Seeds: Story = {
  render: () => (
    <div className="grid grid-cols-6 gap-4">
      {[
        ["northwind", "#2B6CB0", "#FFFFFF", "NW"],
        ["ledgerly", "#1F6F5F", "#E8C56B", "L"],
        ["aurora", "#F5B841", "#0F1318", "AU"],
        ["mono", "#E8ECF1", "#2B6CB0", "M"],
        ["ember", "#B23A2E", "#F5B841", "EM"],
        ["violet", "#6B46C1", "#4FD1C5", "V"],
        ["tide", "#2C7A7B", "#FFFFFF", "T"],
        ["slate", "#4A5568", "#E8ECF1", "SL"],
        ["rose", "#E879C8", "#0F1318", "R"],
        ["lime", "#3DD68C", "#0B0E12", "LI"],
        ["sun", "#FF8A5B", "#FFFFFF", "S"],
        ["ink", "#0B0E12", "#7CC4FF", "IN"],
      ].map(([seed, p, s, m]) => (
        <div key={seed} className="flex flex-col items-center gap-1">
          <Crest seed={seed as string} kitPrimary={p as string} kitSecondary={s as string} monogram={m as string} size={96} />
          <span className="font-mono text-mono text-secondary">{seed}</span>
        </div>
      ))}
    </div>
  ),
};
