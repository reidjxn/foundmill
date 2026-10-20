"use client";
/**
 * Settings › Preferences (founder, 2026-10-11; guidance added 2026-10-20, docs/UX_AUDIT_AND_PLAN.md §6.3): the signed-in
 * person's own choices, the same in every business they open and on every signed-in screen; nobody else's view changes.
 *
 * - The date and time format: two sets of radio cards (the design system's DateFormatPicker) with live examples of today
 *   in each format. A choice saves at once (`founder.preferences.update` through the DateFormatHost, which shows it
 *   everywhere before the answer and rolls back if the save fails) and a toast confirms it in the new format. Relative
 *   times and dates written inside agent notes are not reformatted, and the help line says so.
 * - Guidance: "Explain things as I go" (the guided layer's one switch), the text size, and two ghost buttons that put the
 *   tutoring back to the first day ("Show the first-week checklist again", "Replay the tour"; both are one reset, so
 *   each is off when it has nothing to undo). They save through the GuidanceHost the same way, with a toast.
 *
 * Open to every member, whatever their role: it changes nothing of the business.
 */
import { useQuery } from "@tanstack/react-query";
import { UserRound } from "lucide-react";
import { useCallback, useState } from "react";
import {
  Button,
  Chip,
  DATE_FORMAT_LABELS,
  DATE_FORMAT_SAMPLE,
  DateFormatPicker,
  Label,
  SegmentedControl,
  Switch,
  TIME_FORMAT_LABELS,
  bindFormatters,
  type DateFormatPrefs,
  type SegmentedOption,
  type TextSize,
} from "@foundmill/dugout";
import { useClientNow } from "@/lib/today";
import { useDatePreferences } from "@/components/providers/DateFormatHost";
import { useGuidancePreferences, type GuidancePatch, type GuidancePrefs } from "@/components/providers/GuidanceHost";
import { useTRPC } from "@/lib/trpc-react";
import { AccountId } from "./AccountId";
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

export const TEXT_SIZE_OPTIONS: readonly SegmentedOption<TextSize>[] = [
  { value: "standard", label: "Standard" },
  { value: "comfortable", label: "Comfortable" },
];

/** Which reset buttons have something to undo: the checklist once it was dismissed; the tour once a tour or an intro was seen. */
export function resettable(prefs: Pick<GuidancePrefs, "explainersSeen" | "toursDone" | "checklistDismissedAt">): { checklist: boolean; tour: boolean } {
  return {
    checklist: prefs.checklistDismissedAt !== null,
    tour: Object.keys(prefs.toursDone).length > 0 || Object.keys(prefs.explainersSeen).length > 0,
  };
}

export type GuidanceChange = "guidance" | "textSize" | "reset";

/** The toast after a guidance save: the title names the choice, the line says what follows from it. */
export function guidanceSavedLine(saved: Pick<GuidancePrefs, "guidance" | "textSize">, changed: GuidanceChange): { title: string; description: string } {
  if (changed === "guidance") {
    return saved.guidance === "on"
      ? { title: "Guidance on", description: "Intros, defined words and the first-week checklist show as you go." }
      : { title: "Guidance off", description: "Consequences, provenance and Estimate labels still show. Turn it on again any time from here." };
  }
  if (changed === "textSize") {
    return saved.textSize === "comfortable"
      ? { title: "Comfortable text", description: "Body text reads a little larger, in every business." }
      : { title: "Standard text", description: "Body text is back to its usual size, in every business." };
  }
  return { title: "Starting over", description: "The intros, the first-week checklist and the tours show again." };
}

/** The Guidance section (plan §6.3): the switch, the text size and the two resets, each with one line of help. */
export function GuidanceSection() {
  const { prefs, save } = useGuidancePreferences();
  const t = useSettingsToast();
  const [resetting, setResetting] = useState<"checklist" | "tour" | null>(null);
  const can = resettable(prefs);

  const change = useCallback(
    (patch: GuidancePatch, changed: GuidanceChange) =>
      save(patch).then(
        (saved) => {
          const line = guidanceSavedLine(saved, changed);
          t.saved(line.title, line.description);
        },
        (err: unknown) => t.failed(err, "Preference not saved"),
      ),
    [save, t],
  );
  const reset = (which: "checklist" | "tour") => {
    setResetting(which);
    void change({ reset: true }, "reset").finally(() => setResetting(null));
  };

  return (
    <SettingsSection title="Guidance" data-testid="guidance-panel">
      <Hint>How much the product explains as you go, in every business you open. Consequences, provenance and Estimate labels always show.</Hint>
      <div className="flex items-start gap-3" data-testid="guidance-choice">
        <Switch
          id="guidance-switch"
          checked={prefs.guidance === "on"}
          onCheckedChange={(on) => void change({ guidance: on ? "on" : "off" }, "guidance")}
          aria-describedby="guidance-switch-hint"
          data-testid="guidance-switch"
        />
        <div className="flex flex-col gap-1">
          <Label htmlFor="guidance-switch">Explain things as I go</Label>
          <p id="guidance-switch-hint" className="text-small text-secondary">
            An intro on each screen, defined words you can hover, the first-week checklist and the tours.
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="text-size">Text size</Label>
        <SegmentedControl id="text-size" aria-label="Text size" size="md" options={TEXT_SIZE_OPTIONS} value={prefs.textSize} onValueChange={(size) => void change({ textSize: size }, "textSize")} className="w-fit" data-testid="text-size" />
        <p className="text-small text-secondary">Comfortable makes body text a little larger; nothing on the screen moves.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={can.checklist ? () => reset("checklist") : undefined} aria-disabled={!can.checklist || undefined} loading={resetting === "checklist"} data-testid="show-checklist-again">
            Show the first-week checklist again
          </Button>
          <Button variant="ghost" onClick={can.tour ? () => reset("tour") : undefined} aria-disabled={!can.tour || undefined} loading={resetting === "tour"} data-testid="replay-tour">
            Replay the tour
          </Button>
        </div>
        <p className="text-small text-secondary">Either one puts the intros, the checklist and the tours back to the first day.</p>
      </div>
    </SettingsSection>
  );
}

export function PreferencesTab() {
  const { prefs, save } = useDatePreferences();
  const t = useSettingsToast();
  const now = useClientNow();
  const trpc = useTRPC();
  const viewer = useQuery(trpc.founder.profile.get.queryOptions(undefined, { staleTime: 5 * 60_000 }));

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
    <>
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
      <GuidanceSection />
      <SettingsSection title="Your account ID" data-testid="account-id-panel">
        <AccountId accountId={viewer.data?.userId} />
      </SettingsSection>
    </>
  );
}
