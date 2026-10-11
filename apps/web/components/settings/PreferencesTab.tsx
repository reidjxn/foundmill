"use client";
/**
 * Settings › Preferences (founder, 2026-10-11): the signed-in person's own date and time format, the same in every
 * business they open and on every signed-in screen; nobody else's view changes. Two sets of radio cards (the design
 * system's DateFormatPicker) with live examples of today in each format. A choice saves at once
 * (`founder.preferences.update` through the DateFormatHost, which shows it everywhere before the answer and rolls back if
 * the save fails) and a toast confirms it in the new format. Relative times and dates written inside agent notes are not
 * reformatted, and the help line says so. Open to every member, whatever their role: it changes nothing of the business.
 */
import { UserRound } from "lucide-react";
import { useCallback } from "react";
import { Chip, DATE_FORMAT_LABELS, DATE_FORMAT_SAMPLE, DateFormatPicker, TIME_FORMAT_LABELS, bindFormatters, type DateFormatPrefs } from "@foundmill/dugout";
import { useClientNow } from "@/lib/today";
import { useDatePreferences } from "@/components/providers/DateFormatHost";
import { Hint, SettingsSection, useSettingsToast } from "./shared";

/** The one field a choice changed, or null when it changed nothing. */
export function preferenceChange(current: DateFormatPrefs, next: DateFormatPrefs): Partial<DateFormatPrefs> | null {
  if (next.date !== current.date) return { date: next.date };
  if (next.time !== current.time) return { time: next.time };
  return null;
}

/** The toast after a save, written in the new format: "Dates read 7 Oct 2026 and times 15:45, in every business." */
export function savedLine(saved: DateFormatPrefs, now: Date): { title: string; description: string } {
  const f = bindFormatters(saved);
  return {
    title: `${DATE_FORMAT_LABELS[saved.date]} dates, ${TIME_FORMAT_LABELS[saved.time]} times`,
    description: `Dates read ${f.formatDate(now)} and times ${f.formatTime(now)}, in every business.`,
  };
}

export function PreferencesTab() {
  const { prefs, save } = useDatePreferences();
  const t = useSettingsToast();
  const now = useClientNow();

  const onChange = useCallback(
    (next: DateFormatPrefs) => {
      const change = preferenceChange(prefs, next);
      if (!change) return;
      save(change).then(
        (saved) => {
          const line = savedLine(saved, now ?? DATE_FORMAT_SAMPLE);
          t.saved(line.title, line.description);
        },
        (err: unknown) => t.failed(err, "Preference not saved"),
      );
    },
    [prefs, save, now, t],
  );

  return (
    <SettingsSection
      title="Preferences"
      actions={
        <Chip tone="neutral" icon={UserRound} data-testid="preferences-scope">
          Just for you
        </Chip>
      }
      data-testid="preferences-panel"
    >
      <Hint>
        How you read dates and times, in every business you open; nobody else’s view changes. Relative times such as “3 min ago” and dates written inside agent notes stay as they are.
      </Hint>
      <DateFormatPicker value={prefs} onChange={onChange} now={now} />
    </SettingsSection>
  );
}
