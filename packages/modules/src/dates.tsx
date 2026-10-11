"use client";
/**
 * A date printed in the signed-in person's own format (Settings › Preferences: US, day first or ISO dates; a 12-hour or
 * 24-hour clock), for table cells and other places built outside a component (column builders such as
 * `transactionColumns`), where `useFormatters()` cannot be called. Inside a component, call `useFormatters()` directly.
 *
 *   cell: ({ getValue }) => <DateText value={getValue() as string} className="tabular-nums" />
 *
 * Without a DateFormatProvider above (tests, stories) it reads US dates and 12-hour times, like every helper.
 */
import { formatRelative, useFormatters, type DateFormatKey } from "@foundmill/dugout";

type DateInput = Date | string | number;

export interface DateTextProps {
  /** The moment or calendar day; empty prints `fallback`. */
  value: DateInput | null | undefined;
  /** Which form: "date" (default, "Oct 7, 2026"), "dayMonth", "dateTime", "monthYear" … */
  form?: DateFormatKey;
  /** What an empty value prints (default "—"). */
  fallback?: string;
  className?: string;
}

/** "Oct 7, 2026" / "7 Oct 2026" / "2026-10-07", by the person's choice. */
export function DateText({ value, form = "date", fallback = "—", className }: DateTextProps) {
  const { formatDate } = useFormatters();
  return (
    <span className={className}>
      {value === null || value === undefined || value === "" ? fallback : formatDate(value, form)}
    </span>
  );
}

export interface RelativeDateTextProps {
  value: DateInput;
  /** The clock to measure from (tests and stories pass a fixed one). */
  now?: DateInput;
  /** The absolute form shown on hover (default "date"). */
  titleForm?: DateFormatKey;
  style?: "long" | "short" | "narrow";
  className?: string;
}

/** "3 min ago", with the absolute date in the person's format on hover. Relative words never change with the choice. */
export function RelativeDateText({
  value,
  now,
  titleForm = "date",
  style,
  className,
}: RelativeDateTextProps) {
  const { formatDate } = useFormatters();
  return (
    <span className={className} title={formatDate(value, titleForm)}>
      {formatRelative(value, now ?? new Date(), style ? { style } : {})}
    </span>
  );
}
