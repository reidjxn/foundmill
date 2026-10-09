import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue, SimpleSelect } from "./Select";

const meta = {
  title: "Foundation/Select",
  component: SimpleSelect,
  args: {
    "aria-label": "Model",
    placeholder: "Choose a model",
    options: [
      { value: "opus", label: "Opus" },
      { value: "sonnet", label: "Sonnet" },
      { value: "haiku", label: "Haiku" },
      { value: "locked", label: "Locked by route", disabled: true },
    ],
  },
  argTypes: { controlSize: { control: "inline-radio", options: ["sm", "md", "lg", "xl"] } },
} satisfies Meta<typeof SimpleSelect>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Preselected: Story = { args: { defaultValue: "sonnet" } };
export const Small: Story = { args: { controlSize: "sm", defaultValue: "haiku" } };
export const Invalid: Story = { args: { invalid: true } };

/** The 46 px form select: a code chip and the name; the chevron turns over while the list is open. */
export const FormWithCodes: Story = {
  args: {
    "aria-label": "Currency",
    controlSize: "xl",
    defaultValue: "GBP",
    className: "w-64",
    options: [
      { value: "GBP", code: "GBP", label: "Pound sterling" },
      { value: "EUR", code: "EUR", label: "Euro" },
      { value: "USD", code: "USD", label: "US dollar" },
      { value: "SEK", code: "SEK", label: "Swedish krona" },
    ],
  },
};
export const Disabled: Story = { args: { disabled: true, defaultValue: "opus" } };

export const Composed: Story = {
  render: () => (
    <div className="w-64">
      <Select defaultValue="seo">
        <SelectTrigger aria-label="Channel">
          <SelectValue placeholder="Channel" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Acquisition</SelectLabel>
            <SelectItem value="lead_generation">Lead generation</SelectItem>
            <SelectItem value="paid_ads">Paid advertising</SelectItem>
          </SelectGroup>
          <SelectSeparator />
          <SelectGroup>
            <SelectLabel>Organic</SelectLabel>
            <SelectItem value="seo">SEO</SelectItem>
            <SelectItem value="content">Content marketing</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  ),
};
