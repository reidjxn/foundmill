import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { DateFormatPrefs } from "../../lib/date-preferences";
import { DATE_FORMAT_SAMPLE, DateFormatPicker } from "./DateFormatPicker";

const meta = {
  title: "Foundation/DateFormatPicker",
  component: DateFormatPicker,
  args: { value: { date: "us", time: "12h" }, onChange: () => undefined, now: DATE_FORMAT_SAMPLE },
} satisfies Meta<typeof DateFormatPicker>;
export default meta;

type Story = StoryObj<typeof meta>;

function Controlled({ initial, now }: { initial: DateFormatPrefs; now?: Date }) {
  const [value, setValue] = useState(initial);
  return (
    <div className="surface-panel max-w-reading p-panel-pad">
      <DateFormatPicker value={value} onChange={setValue} now={now} />
    </div>
  );
}

/** Settings › Preferences: US dates and a 12-hour clock until the person chooses. Click a card to see the others follow. */
export const Default: Story = { render: (args) => <Controlled initial={args.value} now={args.now ?? undefined} /> };

/** Day first with a 24-hour clock: the time cards show the time beside the chosen date format. */
export const DayFirst24Hour: Story = { args: { value: { date: "day_first", time: "24h" } }, render: (args) => <Controlled initial={args.value} now={args.now ?? undefined} /> };

/** ISO 8601 dates. */
export const Iso: Story = { args: { value: { date: "iso", time: "24h" } }, render: (args) => <Controlled initial={args.value} now={args.now ?? undefined} /> };

/** While saving, the cards are disabled. */
export const Disabled: Story = { args: { value: { date: "us", time: "12h" }, disabled: true }, render: (args) => <div className="surface-panel max-w-reading p-panel-pad"><DateFormatPicker {...args} /></div> };
