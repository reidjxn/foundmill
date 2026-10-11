import type { Meta, StoryObj } from "@storybook/react-vite";
import { DATE_FORMAT_LABELS, TIME_FORMAT_LABELS, type DateFormatPrefs } from "../../lib/date-preferences";
import { DATE_FORMAT_SAMPLE } from "./DateFormatPicker";
import { DateFormatProvider, useFormatters } from "./DateFormatProvider";

const meta = {
  title: "Foundation/DateFormatProvider",
  component: DateFormatProvider,
} satisfies Meta<typeof DateFormatProvider>;
export default meta;

type Story = StoryObj<typeof meta>;

/** Every form a screen prints, through `useFormatters()`, under the provider's choice. */
function Sampler() {
  const f = useFormatters();
  const at = DATE_FORMAT_SAMPLE;
  const rows: [string, string][] = [
    ["formatDate", f.formatDate(at)],
    ["formatDateShort", f.formatDateShort(at)],
    ["formatDate(d, \"weekdayDayMonth\")", f.formatDate(at, "weekdayDayMonth")],
    ["formatDate(d, \"longDate\")", f.formatDate(at, "longDate")],
    ["formatMonthYear", f.formatMonthYear(at)],
    ["formatTime", f.formatTime(at)],
    ["formatDateTime", f.formatDateTime(at)],
    ["formatRange", f.formatRange(new Date(2026, 9, 7), new Date(2026, 9, 21))],
    ["formatRange (two months, year)", f.formatRange(new Date(2026, 9, 28), new Date(2026, 10, 3), { withYear: true })],
    ["formatHourOfDay", [0, 9, 15].map(f.formatHourOfDay).join(" · ")],
  ];
  return (
    <div className="surface-panel flex w-full flex-col p-panel-pad">
      <p className="t-title text-primary">
        {DATE_FORMAT_LABELS[f.prefs.date]} · {TIME_FORMAT_LABELS[f.prefs.time]}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="t-mono text-tertiary">{k}</dt>
            <dd className="t-mono tabular-nums text-primary">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const CHOICES: DateFormatPrefs[] = [
  { date: "us", time: "12h" },
  { date: "day_first", time: "24h" },
  { date: "iso", time: "24h" },
];

/** The three date formats side by side (each with the clock most people pair it with). */
export const SideBySide: Story = {
  render: () => (
    <div className="grid grid-cols-3 gap-gutter">
      {CHOICES.map((c) => (
        <DateFormatProvider key={`${c.date}.${c.time}`} value={c}>
          <Sampler />
        </DateFormatProvider>
      ))}
    </div>
  ),
};

/** Without a provider (signed-out pages, stories, tests): US dates and a 12-hour clock. */
export const NoProvider: Story = { render: () => <Sampler /> };
