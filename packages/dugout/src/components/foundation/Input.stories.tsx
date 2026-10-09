import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Info, Search } from "lucide-react";
import { Input } from "./Input";
import { Kbd } from "./Kbd";
import { Field, fieldDescribedBy } from "./Label";
import { MoneyInput } from "./MoneyInput";
import { ProvenanceChip } from "./Chip";
import { SimpleSelect } from "./Select";
import { Textarea } from "./Textarea";

const meta = {
  title: "Foundation/Input",
  component: Input,
  args: { placeholder: "Business name" },
  argTypes: { controlSize: { control: "inline-radio", options: ["sm", "md", "lg", "xl"] }, icon: { control: false } },
} satisfies Meta<typeof Input>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { "aria-label": "Business name" } };
export const Small: Story = { args: { controlSize: "sm", "aria-label": "Filter" } };
export const WithIcon: Story = {
  args: { icon: Search, placeholder: "Search everything", "aria-label": "Search", trailing: <Kbd>⌘K</Kbd> },
};
export const Invalid: Story = { args: { invalid: true, defaultValue: "not-an-email", "aria-label": "Email" } };
export const Warning: Story = { args: { tone: "warn", defaultValue: "Use the key sk-ant-…", "aria-label": "Instruction" } };
export const Units: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      <Input aria-label="Share" numeric defaultValue="12.5" suffix="%" />
      <Input aria-label="Runway" numeric defaultValue="14" suffix="months" />
      <Input aria-label="Spend cap" numeric defaultValue="2,500" suffix="GBP" suffixVariant="segment" />
    </div>
  ),
};

/** Heights: sm 28 and md 32 (toolbars, beside buttons), lg 36 (form fields), xl 46 (MoneyInput, form selects). */
export const Sizes: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-3">
      {(["sm", "md", "lg", "xl"] as const).map((s) => (
        <Input key={s} controlSize={s} aria-label={`Size ${s}`} placeholder={`controlSize="${s}"`} />
      ))}
    </div>
  ),
};
export const Mono: Story = { args: { mono: true, defaultValue: "sk-ant-…", "aria-label": "API key" } };
export const Numeric: Story = { args: { numeric: true, defaultValue: "12,400.00", "aria-label": "Amount" } };
export const Disabled: Story = { args: { disabled: true, defaultValue: "Read only", "aria-label": "Read only" } };

export const InAField: Story = {
  render: () => (
    <div className="flex w-80 flex-col gap-4">
      <Field htmlFor="biz" label="Business name" hint="Shown in the top bar and on the logo." required>
        <Input id="biz" placeholder="Northwind Skincare" aria-describedby={fieldDescribedBy("biz", { hint: true })} />
      </Field>
      <Field htmlFor="email" label="Founder email" error="That does not look like an email address.">
        <Input id="email" defaultValue="ada@" invalid aria-describedby={fieldDescribedBy("email", { error: true })} />
      </Field>
      <Field htmlFor="notes" label="Notes to the team" hint="Plain language. The Chief of Staff reads this every cycle.">
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

function Budget() {
  const [budget, setBudget] = useState("60000");
  const [currency, setCurrency] = useState("GBP");
  return (
    <div className="grid w-reading grid-cols-4 gap-4">
      <Field htmlFor="budget" label="Budget you can commit" required className="col-span-3">
        <MoneyInput id="budget" value={budget} onChange={(e) => setBudget(e.target.value)} currency={currency} placeholder="25000" aria-describedby="budget-help" />
      </Field>
      <Field htmlFor="currency" label="Currency">
        <SimpleSelect
          id="currency"
          controlSize="xl"
          value={currency}
          onValueChange={setCurrency}
          options={[
            { value: "GBP", code: "GBP", label: "Pound sterling" },
            { value: "EUR", code: "EUR", label: "Euro" },
            { value: "USD", code: "USD", label: "US dollar" },
            { value: "SEK", code: "SEK", label: "Swedish krona" },
          ]}
          aria-label="Currency"
        />
      </Field>
      <p id="budget-help" className="col-span-4 -mt-2 flex items-center gap-2 text-small text-secondary">
        <Info size={14} aria-hidden /> About 14 months of a lean team at today's prices <ProvenanceChip kind="estimate" />
      </p>
      <p className="col-span-4 font-mono text-mono text-tertiary">raw value: {JSON.stringify(budget)}</p>
    </div>
  );
}

/**
 * MoneyInput: [symbol] [amount] … | CODE. At rest the amount is grouped for the locale ("60,000", "25k" → "25,000");
 * focused, it shows exactly what was typed. The caller always receives the raw text.
 */
export const Money: Story = { name: "MoneyInput", render: () => <Budget /> };

export const MoneyCompact: Story = {
  name: "MoneyInput (md, in a toolbar)",
  render: () => (
    <div className="flex w-72 flex-col gap-3">
      <MoneyInput controlSize="md" aria-label="Weekly ceiling" defaultValue="1250" currency="EUR" />
      <MoneyInput controlSize="md" aria-label="Spend cap" defaultValue="1250000000" currency="SEK" />
      <MoneyInput controlSize="md" aria-label="No symbol" defaultValue="40k" currency="USD" symbol={false} />
    </div>
  ),
};
