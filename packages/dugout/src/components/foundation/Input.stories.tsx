import type { Meta, StoryObj } from "@storybook/react-vite";
import { Search } from "lucide-react";
import { Input } from "./Input";
import { Kbd } from "./Kbd";
import { Field, fieldDescribedBy } from "./Label";
import { Textarea } from "./Textarea";

const meta = {
  title: "Foundation/Input",
  component: Input,
  args: { placeholder: "Business name" },
  argTypes: { controlSize: { control: "inline-radio", options: ["sm", "md"] }, icon: { control: false } },
} satisfies Meta<typeof Input>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { "aria-label": "Business name" } };
export const Small: Story = { args: { controlSize: "sm", "aria-label": "Filter" } };
export const WithIcon: Story = {
  args: { icon: Search, placeholder: "Search everything", "aria-label": "Search", trailing: <Kbd>⌘K</Kbd> },
};
export const Invalid: Story = { args: { invalid: true, defaultValue: "not-an-email", "aria-label": "Email" } };
export const Mono: Story = { args: { mono: true, defaultValue: "sk-ant-…", "aria-label": "API key" } };
export const Numeric: Story = { args: { numeric: true, defaultValue: "12,400.00", "aria-label": "Amount" } };
export const Disabled: Story = { args: { disabled: true, defaultValue: "Read only", "aria-label": "Read only" } };

export const InAField: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <Field htmlFor="biz" label="Business name" hint="Shown in the top bar and on the crest." required>
        <Input id="biz" placeholder="Northwind Skincare" aria-describedby={fieldDescribedBy("biz", { hint: true })} />
      </Field>
      <Field htmlFor="email" label="Founder email" error="That does not look like an email address.">
        <Input id="email" defaultValue="ada@" invalid aria-describedby={fieldDescribedBy("email", { error: true })} />
      </Field>
      <Field htmlFor="notes" label="Notes to the squad" hint="Plain language. The Chief of Staff reads this every cycle.">
        <Textarea id="notes" placeholder="Focus on activation this week." aria-describedby={fieldDescribedBy("notes", { hint: true })} />
      </Field>
    </div>
  ),
};

export const TextareaStory: Story = {
  name: "Textarea",
  render: () => (
    <div className="flex w-96 flex-col gap-3">
      <Textarea aria-label="Message" placeholder="Write a message to the lead agent…" />
      <Textarea aria-label="Growing" autoGrow placeholder="Grows with content" rows={2} />
      <Textarea aria-label="Log" mono defaultValue={"$ pnpm test\n✓ 57 passed"} />
    </div>
  ),
};
