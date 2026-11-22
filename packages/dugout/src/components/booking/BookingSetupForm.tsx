"use client";
/**
 * Booking setup, in the console (founder, Nov 22, 2026: Foundmill's own booking, free on every plan). One screen to edit
 * the time zone, the weekly hours, the services and the calendar switch; the status line says whether visitors can book.
 * Desktop, 1280 px and wider. Presentational: `onSave(draft)` and `onSetLive(on)` do the work. The hours are checked with
 * `weeklyHoursProblem`; a window is chosen in 30-minute steps. Turning booking on needs the page published and the
 * changes saved, and says why when it cannot.
 */
import { useId, useMemo, useState, type ChangeEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { BOOKING_LIMITS, BOOKING_SLOT_STEP_MIN, durationLabel, minutesLabel, weeklyHoursProblem, type HoursWindow, type WeeklyHours } from "@foundmill/shared/booking";
import { cn } from "../../lib/cn";
import { currencySymbol, formatDate } from "../../lib/format";
import { Button } from "../foundation/Button";
import { Field, Label } from "../foundation/Label";
import { IconButton } from "../foundation/IconButton";
import { Input } from "../foundation/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../foundation/Select";
import { Switch } from "../foundation/Switch";
import { Panel } from "../shell/Panel";
import type { BookingMode, BookingSetupDraft, BookingSetupService } from "./types";

export const BOOKING_SETUP_WORDS = {
  draft: "Not public yet. Visitors cannot book.",
  live: (since: string) => `Live on your page since ${since}`,
  teamDrafted: "Your team drafted this from what you told them. Check it before you turn it on.",
  save: "Save",
  turnOn: "Turn on booking",
  turnOff: "Turn off booking",
  notPublished: "Publish your project's page first.",
  unsaved: "Save your changes first.",
  calendar: "Skip times when my Google Calendar is busy, and add bookings to it",
  calendarOff: "Connect Google Calendar in Settings › Integrations first.",
  noServices: "Add at least one service.",
  serviceName: "Give every service a name.",
  duration: `A service lasts ${BOOKING_LIMITS.durationMin.min} to ${BOOKING_LIMITS.durationMin.max} minutes.`,
} as const;

/** Monday first; the keys are the weekday numbers `WeeklyHours` uses (0 is Sunday). */
const DAYS = [
  { key: "1", name: "Monday" },
  { key: "2", name: "Tuesday" },
  { key: "3", name: "Wednesday" },
  { key: "4", name: "Thursday" },
  { key: "5", name: "Friday" },
  { key: "6", name: "Saturday" },
  { key: "0", name: "Sunday" },
] as const;
type DayKey = (typeof DAYS)[number]["key"];

const range = (from: number, to: number) => Array.from({ length: Math.floor((to - from) / BOOKING_SLOT_STEP_MIN) + 1 }, (_, i) => from + i * BOOKING_SLOT_STEP_MIN);
const START_OPTIONS = range(0, 1440 - BOOKING_SLOT_STEP_MIN);
const END_OPTIONS = range(BOOKING_SLOT_STEP_MIN, 1440);
const NOTICE_PRESETS = [0, 60, 120, 240, 720, 1440, 2880, 10080];
const dayCount = (min: number) => (min >= 1440 && min % 1440 === 0 ? `${min / 1440} day${min === 1440 ? "" : "s"}` : durationLabel(min));
const noticeText = (min: number) => (min === 0 ? "No notice" : dayCount(min));

/** What is wrong with the services, in words a founder can act on, or null. */
export function servicesProblem(services: readonly BookingSetupService[]): string | null {
  if (services.length === 0) return BOOKING_SETUP_WORDS.noServices;
  for (const s of services) {
    if (!s.name.trim()) return BOOKING_SETUP_WORDS.serviceName;
    if (!Number.isInteger(s.durationMin) || s.durationMin < BOOKING_LIMITS.durationMin.min || s.durationMin > BOOKING_LIMITS.durationMin.max) return BOOKING_SETUP_WORDS.duration;
  }
  return null;
}

export interface BookingSetupFormProps {
  /** The saved setup (or the team's draft). The form edits its own copy until Save. */
  draft: BookingSetupDraft;
  status: "draft" | "live";
  /** When it went live (ISO or Date); shown in the status line. */
  liveSince?: string | Date | null;
  /** IANA zone ids to choose from. */
  timeZones: readonly string[];
  /** Currency of the prices (ISO 4217). Default USD. */
  currency?: string;
  calendarConnected: boolean;
  pagePublished: boolean;
  /** The team wrote this setup from what the founder said. */
  draftedByTeam?: boolean;
  saving?: boolean;
  error?: string | null;
  onSave: (draft: BookingSetupDraft) => void;
  onSetLive: (live: boolean) => void;
  className?: string;
}

const blankService = (): BookingSetupService => ({ name: "", durationMin: 60, bufferBeforeMin: 0, bufferAfterMin: 0, priceMinor: null, mode: "online", minNoticeMin: 1440, maxDaysAhead: 60, questions: [] });

function PriceField({ id, currency, value, onChange }: { id: string; currency: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? "" : String(value / 100));
  return (
    <Input
      id={id}
      inputMode="decimal"
      prefix={currencySymbol(currency) ?? currency}
      placeholder="Free"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const n = Number(raw.replace(/[,\s]/g, ""));
        onChange(raw.trim() === "" ? null : Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : value);
      }}
    />
  );
}

function TimeSelect({ label, value, options, onChange }: { label: string; value: number; options: readonly number[]; onChange: (v: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label={label} className="w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={String(o)}>
            {minutesLabel(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function BookingSetupForm({ draft: saved, status, liveSince, timeZones, currency = "USD", calendarConnected, pagePublished, draftedByTeam = false, saving = false, error = null, onSave, onSetLive, className }: BookingSetupFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<BookingSetupDraft>(saved);
  const hoursProblem = weeklyHoursProblem(draft.weeklyHours);
  const problem = hoursProblem ?? servicesProblem(draft.services);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(saved), [draft, saved]);
  const zones = timeZones.includes(draft.timeZone) ? timeZones : [draft.timeZone, ...timeZones];
  const live = status === "live";
  const turnOnReason = !pagePublished ? BOOKING_SETUP_WORDS.notPublished : problem ? problem : dirty ? BOOKING_SETUP_WORDS.unsaved : null;

  const setHours = (key: DayKey, windows: HoursWindow[] | null) =>
    setDraft((d) => {
      const next: WeeklyHours = { ...d.weeklyHours };
      if (windows && windows.length) next[key] = windows;
      else delete next[key];
      return { ...d, weeklyHours: next };
    });
  const setService = (i: number, patch: Partial<BookingSetupService>) => setDraft((d) => ({ ...d, services: d.services.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const num = (i: number, key: "durationMin" | "bufferBeforeMin" | "bufferAfterMin" | "maxDaysAhead", min: number, max: number) => ({
    type: "number" as const,
    min,
    max,
    numeric: true,
    value: Number.isFinite(draft.services[i]![key]) ? draft.services[i]![key] : "",
    onChange: (e: ChangeEvent<HTMLInputElement>) => setService(i, { [key]: e.target.value === "" ? Number.NaN : Number(e.target.value) }),
  });

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} data-booking-setup="">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="t-body text-primary" role="status" data-booking-status={status}>
          {live ? (liveSince ? BOOKING_SETUP_WORDS.live(formatDate(liveSince, "date")) : "Live on your page") : BOOKING_SETUP_WORDS.draft}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="primary" loading={saving} disabled={Boolean(problem) || !dirty} onClick={() => onSave(draft)}>
            {BOOKING_SETUP_WORDS.save}
          </Button>
          {live ? (
            <Button variant="secondary" disabled={saving} onClick={() => onSetLive(false)}>
              {BOOKING_SETUP_WORDS.turnOff}
            </Button>
          ) : (
            <Button variant="secondary" disabled={saving || Boolean(turnOnReason)} aria-describedby={turnOnReason ? `${id}-why` : undefined} onClick={() => onSetLive(true)}>
              {BOOKING_SETUP_WORDS.turnOn}
            </Button>
          )}
        </div>
      </div>
      {!live && turnOnReason ? (
        <p id={`${id}-why`} className="t-small text-secondary">
          {turnOnReason}
        </p>
      ) : null}
      {draftedByTeam ? <p className="t-body text-secondary">{BOOKING_SETUP_WORDS.teamDrafted}</p> : null}
      {problem ? (
        <p role="alert" className="t-body text-status-bad" data-booking-problem="">
          {problem}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="t-body text-status-bad">
          {error}
        </p>
      ) : null}

      <Panel title="Hours" span={12}>
        <div className="flex flex-col gap-3">
          <Field label="Time zone" htmlFor={`${id}-zone`} hint="Your hours are in this zone. Visitors see times in their own.">
            <Select value={draft.timeZone} onValueChange={(v) => setDraft((d) => ({ ...d, timeZone: v }))}>
              <SelectTrigger id={`${id}-zone`} className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <ul role="list" className="flex flex-col gap-2" aria-label="Weekly hours">
            {DAYS.map(({ key, name }) => {
              const windows = draft.weeklyHours[key] ?? [];
              const open = windows.length > 0;
              return (
                <li key={key} className="flex items-start gap-3 border-t border-line-faint pt-2 first:border-t-0 first:pt-0">
                  <div className="flex h-control-md w-40 shrink-0 items-center gap-2">
                    <Switch size="sm" id={`${id}-open-${key}`} checked={open} onCheckedChange={(on) => setHours(key, on ? [{ start: 540, end: 1020 }] : null)} />
                    <Label htmlFor={`${id}-open-${key}`} className="text-primary">
                      {name}
                    </Label>
                  </div>
                  {open ? (
                    <div className="flex flex-col gap-1.5">
                      {windows.map((w, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <TimeSelect label={`${name} set ${i + 1} starts`} value={w.start} options={START_OPTIONS} onChange={(v) => setHours(key, windows.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
                          <span className="t-small text-secondary">to</span>
                          <TimeSelect label={`${name} set ${i + 1} ends`} value={w.end} options={END_OPTIONS} onChange={(v) => setHours(key, windows.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
                          <IconButton icon={X} size="sm" label={`Remove ${name} set ${i + 1}`} onClick={() => setHours(key, windows.filter((_, j) => j !== i))} />
                        </div>
                      ))}
                      {windows.length < BOOKING_LIMITS.windowsPerDay ? (
                        <Button variant="ghost" size="sm" icon={Plus} className="self-start" onClick={() => setHours(key, [...windows, { start: Math.min(windows[windows.length - 1]!.end, 1380), end: Math.min(windows[windows.length - 1]!.end + 60, 1440) }])}>
                          Add hours for {name}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="t-body flex h-control-md items-center text-tertiary">Closed</p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center gap-3">
            <Switch id={`${id}-cal`} checked={draft.useCalendar && calendarConnected} disabled={!calendarConnected} aria-describedby={calendarConnected ? undefined : `${id}-cal-hint`} onCheckedChange={(on) => setDraft((d) => ({ ...d, useCalendar: on }))} />
            <div className="flex flex-col">
              <Label htmlFor={`${id}-cal`} className="text-primary">
                {BOOKING_SETUP_WORDS.calendar}
              </Label>
              {calendarConnected ? null : (
                <p id={`${id}-cal-hint`} className="t-small text-secondary">
                  {BOOKING_SETUP_WORDS.calendarOff}
                </p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="Services" span={12}>
        <div className="flex flex-col gap-3">
          {draft.services.map((s, i) => {
            const p = `${id}-s${i}`;
            return (
              <section key={s.id ?? `new-${i}`} aria-label={s.name || `Service ${i + 1}`} className="flex flex-col gap-3 rounded-md border border-line p-3" data-booking-service="">
                <div className="grid grid-cols-4 gap-3">
                  <Field label="Name" htmlFor={`${p}-name`} className="col-span-2">
                    <Input id={`${p}-name`} maxLength={BOOKING_LIMITS.serviceName} value={s.name} onChange={(e) => setService(i, { name: e.target.value })} />
                  </Field>
                  <Field label="Price" htmlFor={`${p}-price`} hint="Leave empty for free.">
                    <PriceField id={`${p}-price`} currency={currency} value={s.priceMinor} onChange={(v) => setService(i, { priceMinor: v })} />
                  </Field>
                  <Field label="Where" htmlFor={`${p}-mode`}>
                    <Select value={s.mode} onValueChange={(v) => setService(i, { mode: v as BookingMode })}>
                      <SelectTrigger id={`${p}-mode`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="online">Online</SelectItem>
                        <SelectItem value="in_person">In person</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Minutes long" htmlFor={`${p}-dur`}>
                    <Input id={`${p}-dur`} {...num(i, "durationMin", BOOKING_LIMITS.durationMin.min, BOOKING_LIMITS.durationMin.max)} />
                  </Field>
                  <Field label="Buffer before (minutes)" htmlFor={`${p}-bb`}>
                    <Input id={`${p}-bb`} {...num(i, "bufferBeforeMin", 0, BOOKING_LIMITS.bufferMin.max)} />
                  </Field>
                  <Field label="Buffer after (minutes)" htmlFor={`${p}-ba`}>
                    <Input id={`${p}-ba`} {...num(i, "bufferAfterMin", 0, BOOKING_LIMITS.bufferMin.max)} />
                  </Field>
                  <Field label="Notice needed" htmlFor={`${p}-notice`}>
                    <Select value={String(s.minNoticeMin)} onValueChange={(v) => setService(i, { minNoticeMin: Number(v) })}>
                      <SelectTrigger id={`${p}-notice`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(NOTICE_PRESETS.includes(s.minNoticeMin) ? NOTICE_PRESETS : [...NOTICE_PRESETS, s.minNoticeMin].sort((a, b) => a - b)).map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {noticeText(m)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="How many days ahead" htmlFor={`${p}-ahead`}>
                    <Input id={`${p}-ahead`} {...num(i, "maxDaysAhead", BOOKING_LIMITS.daysAhead.min, BOOKING_LIMITS.daysAhead.max)} />
                  </Field>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="t-label text-secondary">Questions for the customer (optional, up to {BOOKING_LIMITS.questions})</p>
                  {s.questions.map((q, qi) => (
                    <div key={qi} className="flex items-center gap-2">
                      <Input aria-label={`Question ${qi + 1} for ${s.name || `service ${i + 1}`}`} maxLength={BOOKING_LIMITS.question} value={q} onChange={(e) => setService(i, { questions: s.questions.map((x, j) => (j === qi ? e.target.value : x)) })} />
                      <IconButton icon={X} size="sm" label={`Remove question ${qi + 1}`} onClick={() => setService(i, { questions: s.questions.filter((_, j) => j !== qi) })} />
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    {s.questions.length < BOOKING_LIMITS.questions ? (
                      <Button variant="ghost" size="sm" icon={Plus} onClick={() => setService(i, { questions: [...s.questions, ""] })}>
                        Add a question
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDraft((d) => ({ ...d, services: d.services.filter((_, j) => j !== i) }))}>
                      Remove this service
                    </Button>
                  </div>
                </div>
              </section>
            );
          })}
          {draft.services.length < BOOKING_LIMITS.services ? (
            <Button variant="secondary" icon={Plus} className="self-start" onClick={() => setDraft((d) => ({ ...d, services: [...d.services, blankService()] }))}>
              Add a service
            </Button>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
