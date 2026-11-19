/** Google Calendar: read the founder's calendar, create/update events, find free slots. */
import { z } from "zod";
import { defineTool } from "../../define";

export const GOOGLE_CALENDAR_KEY = "google_calendar";
export const CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];

const Iso = z.iso.datetime({ offset: true });
export const CalendarEvent = z.object({
  id: z.string(),
  calendarId: z.string(),
  summary: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  start: z.string(),
  end: z.string(),
  allDay: z.boolean(),
  attendees: z.array(z.object({ email: z.string(), responseStatus: z.string() })),
  organizer: z.string().nullable(),
  status: z.string(),
  htmlLink: z.string().nullable(),
  meetLink: z.string().nullable(),
});
export type CalendarEventT = z.infer<typeof CalendarEvent>;

const CalendarId = z.string().min(1).max(200).default("primary");
const EventId = z.string().min(1).max(200);

export const googleCalendarTools = [
  defineTool({ name: "list_calendars", description: "Calendars the connected account can see.", input: z.object({}), output: z.object({ items: z.array(z.object({ id: z.string(), summary: z.string(), primary: z.boolean(), timeZone: z.string().nullable() })) }), hints: {}, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "list_events",
    description: "Events in a time window (single instances, ordered by start). Descriptions may come from external organizers.",
    input: z.object({ calendarId: CalendarId, timeMin: Iso, timeMax: Iso, maxResults: z.number().int().min(1).max(250).default(50), q: z.string().max(200).optional() }),
    output: z.object({ items: z.array(CalendarEvent) }),
    hints: {},
    untrusted: "api",
    untrustedRef: (a) => `events:${a.calendarId}:${a.timeMin}`,
    annotations: { readOnlyHint: true },
  }),
  defineTool({ name: "get_event", description: "Fetch one event by id, with its attendees, times and status.", input: z.object({ calendarId: CalendarId, eventId: EventId }), output: CalendarEvent, hints: {}, untrusted: "api", untrustedRef: (a) => `event:${a.eventId}`, annotations: { readOnlyHint: true } }),
  defineTool({
    name: "create_event",
    description: "Create an event; attendees receive invitations (sendUpdates). Use for founder-approved calls with leads, suppliers and candidates.",
    input: z.object({ calendarId: CalendarId, summary: z.string().min(1).max(300), description: z.string().max(5000).optional(), location: z.string().max(500).optional(), start: Iso, end: Iso, timeZone: z.string().max(60).default("Europe/Stockholm"), attendees: z.array(z.email()).max(50).default([]), addMeetLink: z.boolean().default(false), sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all") }).refine((v) => Date.parse(v.end) > Date.parse(v.start), "end must be after start"),
    output: CalendarEvent,
    hints: { contactsThirdParty: true },
  }),
  // The founder's own calendar, nobody else's: no attendees and no invitations, so it runs like a draft (founder, Nov 19, 2026).
  defineTool({
    name: "add_event",
    description: "Put an event on the founder's own calendar with no attendees: nobody is invited or notified. To invite people, use create_event, which asks the founder first.",
    input: z.object({ calendarId: CalendarId, summary: z.string().min(1).max(300), description: z.string().max(5000).optional(), location: z.string().max(500).optional(), start: Iso, end: Iso, timeZone: z.string().max(60).default("Europe/Stockholm") }).refine((v) => Date.parse(v.end) > Date.parse(v.start), "end must be after start"),
    output: CalendarEvent,
    hints: {},
    annotations: { readOnlyHint: false },
  }),
  defineTool({
    name: "update_event",
    description: "Change an event's time, title, description, location or attendee list; attendees are notified.",
    input: z.object({ calendarId: CalendarId, eventId: EventId, summary: z.string().min(1).max(300).optional(), description: z.string().max(5000).optional(), location: z.string().max(500).optional(), start: Iso.optional(), end: Iso.optional(), attendees: z.array(z.email()).max(50).optional(), sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all") }),
    output: CalendarEvent,
    hints: { contactsThirdParty: true },
  }),
  defineTool({ name: "delete_event", description: "Cancel an event; attendees receive a cancellation. Cannot be undone by the API.", input: z.object({ calendarId: CalendarId, eventId: EventId, sendUpdates: z.enum(["all", "externalOnly", "none"]).default("all") }), output: z.object({ deleted: z.literal(true), eventId: z.string() }), hints: { contactsThirdParty: true, irreversible: true } }),
  defineTool({
    name: "find_free_slots",
    description: "Free slots of a given length inside working hours in a window (free/busy only; no event details).",
    input: z.object({ calendarId: CalendarId, timeMin: Iso, timeMax: Iso, durationMinutes: z.number().int().min(15).max(480).default(30), workingHours: z.object({ startHour: z.number().int().min(0).max(23).default(9), endHour: z.number().int().min(1).max(24).default(17) }).default({ startHour: 9, endHour: 17 }), maxSlots: z.number().int().min(1).max(50).default(10) }),
    output: z.object({ slots: z.array(z.object({ start: z.string(), end: z.string() })) }),
    hints: {},
    annotations: { readOnlyHint: true },
  }),
] as const;

export const GOOGLE_CALENDAR_RATE_LIMITS = { perMinute: 100, perDay: 10_000 };

/* ---- Vendor shapes (subset) ---- */
export interface GEventTime { dateTime?: string; date?: string; timeZone?: string }
export interface GEvent { id: string; status?: string; summary?: string; description?: string; location?: string; start?: GEventTime; end?: GEventTime; attendees?: { email: string; responseStatus?: string }[]; organizer?: { email?: string }; htmlLink?: string; hangoutLink?: string; conferenceData?: { entryPoints?: { uri?: string; entryPointType?: string }[] } }

const timeOf = (t: GEventTime | undefined): { iso: string; allDay: boolean } => (t?.dateTime ? { iso: new Date(t.dateTime).toISOString(), allDay: false } : t?.date ? { iso: new Date(`${t.date}T00:00:00.000Z`).toISOString(), allDay: true } : { iso: new Date(0).toISOString(), allDay: false });

export function mapEvent(calendarId: string, e: GEvent): CalendarEventT {
  const start = timeOf(e.start);
  const end = timeOf(e.end);
  return {
    id: e.id, calendarId, summary: e.summary ?? "(no title)", description: e.description ?? null, location: e.location ?? null, start: start.iso, end: end.iso, allDay: start.allDay,
    attendees: (e.attendees ?? []).map((a) => ({ email: a.email, responseStatus: a.responseStatus ?? "needsAction" })), organizer: e.organizer?.email ?? null, status: e.status ?? "confirmed", htmlLink: e.htmlLink ?? null,
    meetLink: e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null,
  };
}

/** Pure slot finder over busy intervals, shared by live (freeBusy) and mock. Working hours are interpreted in UTC. */
export function freeSlots(busy: { start: string; end: string }[], window: { timeMin: string; timeMax: string }, durationMinutes: number, hours: { startHour: number; endHour: number }, maxSlots: number): { start: string; end: string }[] {
  const slots: { start: string; end: string }[] = [];
  const dur = durationMinutes * 60_000;
  const intervals = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const).sort((a, b) => a[0] - b[0]);
  let cursor = Date.parse(window.timeMin);
  const max = Date.parse(window.timeMax);
  cursor = Math.ceil(cursor / (15 * 60_000)) * 15 * 60_000;
  while (cursor + dur <= max && slots.length < maxSlots) {
    const d = new Date(cursor);
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    if (hour < hours.startHour) { cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours.startHour); continue; }
    if (hour + durationMinutes / 60 > hours.endHour || d.getUTCDay() === 0 || d.getUTCDay() === 6) { cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hours.startHour); continue; }
    const conflict = intervals.find(([s, e]) => s < cursor + dur && e > cursor);
    if (conflict) { cursor = Math.ceil(conflict[1] / (15 * 60_000)) * 15 * 60_000; continue; }
    slots.push({ start: new Date(cursor).toISOString(), end: new Date(cursor + dur).toISOString() });
    cursor += dur;
  }
  return slots;
}
