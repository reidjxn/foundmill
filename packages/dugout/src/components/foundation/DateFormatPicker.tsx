"use client";
/**
 * The two choices of Settings › Preferences as radio cards (DESIGN §8): the date format (US, day first, ISO 8601) and
 * the time format (12-hour, 24-hour). Every card shows what the choice looks like on a real moment, so the person
 * picks by sight; the time cards show it next to the chosen date format. Controlled: `onChange` gets the whole new
 * choice, and the parent saves it.
 */
import { useId } from "react";
import { cn } from "../../lib/cn";
import { DATE_FORMAT_LABELS, DATE_FORMAT_PREFERENCES, TIME_FORMAT_LABELS, TIME_FORMAT_PREFERENCES, type DateFormatPreference, type DateFormatPrefs, type TimeFormatPreference } from "../../lib/date-preferences";
import { formatDate } from "../../lib/format";
import { RadioCard, RadioGroup } from "./RadioGroup";

/** The examples' moment when the parent has none yet (before the browser knows the person's own clock). */
export const DATE_FORMAT_SAMPLE = new Date(2026, 9, 7, 15, 45);

export interface DateFormatPickerProps {
  value: DateFormatPrefs;
  onChange: (next: DateFormatPrefs) => void;
  /** The moment the examples show (today, now); DATE_FORMAT_SAMPLE when absent. */
  now?: Date | null;
  disabled?: boolean;
  className?: string;
}

/** The examples of one choice, one per line (a separator would lead the second line once the card wraps). */
function Example({ parts }: { parts: string[] }) {
  return (
    <span className="flex flex-col font-mono tabular-nums">
      {parts.map((p, i) => (
        <span key={i} className="whitespace-nowrap">
          {p}
        </span>
      ))}
    </span>
  );
}

export function DateFormatPicker({ value, onChange, now, disabled, className }: DateFormatPickerProps) {
  const id = useId();
  const dateLegend = `${id}-date`;
  const timeLegend = `${id}-time`;
  const at = now ?? DATE_FORMAT_SAMPLE;
  const dateExample = (date: DateFormatPreference) => [formatDate(at, "date", { date, time: value.time }), formatDate(at, "weekdayDayMonth", { date, time: value.time })];
  const timeExample = (time: TimeFormatPreference) => [formatDate(at, "time", { date: value.date, time }), formatDate(at, "dateTime", { date: value.date, time })];
  return (
    <div className={cn("flex flex-col gap-5", className)} data-testid="date-format-picker">
      <section className="flex flex-col gap-2" aria-labelledby={dateLegend}>
        <h3 id={dateLegend} className="t-label">
          Date format
        </h3>
        <RadioGroup
          value={value.date}
          onValueChange={(v) => onChange({ ...value, date: v as DateFormatPreference })}
          aria-labelledby={dateLegend}
          disabled={disabled}
          className="grid-cols-3"
        >
          {DATE_FORMAT_PREFERENCES.map((d) => (
            <RadioCard key={d} value={d} label={DATE_FORMAT_LABELS[d]} description={<Example parts={dateExample(d)} />} data-testid={`date-format-${d}`} />
          ))}
        </RadioGroup>
      </section>
      <section className="flex flex-col gap-2" aria-labelledby={timeLegend}>
        <h3 id={timeLegend} className="t-label">
          Time format
        </h3>
        <RadioGroup
          value={value.time}
          onValueChange={(v) => onChange({ ...value, time: v as TimeFormatPreference })}
          aria-labelledby={timeLegend}
          disabled={disabled}
          className="grid-cols-3"
        >
          {TIME_FORMAT_PREFERENCES.map((t) => (
            <RadioCard key={t} value={t} label={TIME_FORMAT_LABELS[t]} description={<Example parts={timeExample(t)} />} data-testid={`time-format-${t}`} />
          ))}
        </RadioGroup>
      </section>
    </div>
  );
}
