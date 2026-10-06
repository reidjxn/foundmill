import { buildMockConnector } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, stableHash } from "../../mock-utils";
import { CALENDARS, EVENTS } from "./fixtures/events";
import { freeSlots, GOOGLE_CALENDAR_KEY, GOOGLE_CALENDAR_RATE_LIMITS, GOOGLE_CALENDAR_SCOPES, googleCalendarTools, mapEvent, type GEvent } from "./tools";

const notFound = (what: string) => Object.assign(new Error(`${what} not found`), { status: 404 });

export function createGoogleCalendarMock() {
  const events = new Map<string, GEvent>(EVENTS.map((e) => [e.id, structuredClone(e)]));
  const inWindow = (e: GEvent, timeMin: string, timeMax: string) => {
    const m = mapEvent("primary", e);
    return Date.parse(m.start) < Date.parse(timeMax) && Date.parse(m.end) > Date.parse(timeMin);
  };

  return buildMockConnector({
    key: GOOGLE_CALENDAR_KEY,
    displayName: "Google Calendar",
    phase: 1,
    auth: { kind: "oauth", scopes: GOOGLE_CALENDAR_SCOPES },
    tools: googleCalendarTools,
    rateLimits: GOOGLE_CALENDAR_RATE_LIMITS,
    now: () => MOCK_NOW,
    handlers: {
      list_calendars: async () => ({ items: CALENDARS }),
      list_events: async ({ calendarId, timeMin, timeMax, maxResults, q }) => ({ items: [...events.values()].filter((e) => e.status !== "cancelled" && inWindow(e, timeMin, timeMax) && (!q || `${e.summary} ${e.description ?? ""}`.toLowerCase().includes(q.toLowerCase()))).map((e) => mapEvent(calendarId, e)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, maxResults) }),
      get_event: async ({ calendarId, eventId }) => {
        const e = events.get(eventId);
        if (!e) throw notFound(`event ${eventId}`);
        return mapEvent(calendarId, e);
      },
      create_event: async ({ calendarId, summary, description, location, start, end, attendees, addMeetLink }) => {
        const id = `evt_${stableHash([summary, start, attendees], 12)}`;
        const e: GEvent = { id, status: "confirmed", summary, description, location, start: { dateTime: start }, end: { dateTime: end }, attendees: attendees.map((email) => ({ email, responseStatus: "needsAction" })), organizer: { email: "reid@northwindskincare.com" }, htmlLink: `https://calendar.google.com/event?eid=${id}`, ...(addMeetLink ? { hangoutLink: `https://meet.google.com/${stableHash(id, 3)}-${stableHash([id, 1], 4)}-${stableHash([id, 2], 3)}` } : {}) };
        events.set(id, e);
        return mapEvent(calendarId, e);
      },
      update_event: async ({ calendarId, eventId, attendees, start, end, ...patch }) => {
        const e = events.get(eventId);
        if (!e) throw notFound(`event ${eventId}`);
        const updated: GEvent = { ...e, ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== undefined && k !== "sendUpdates")), ...(start ? { start: { dateTime: start } } : {}), ...(end ? { end: { dateTime: end } } : {}), ...(attendees ? { attendees: attendees.map((email) => ({ email, responseStatus: e.attendees?.find((a) => a.email === email)?.responseStatus ?? "needsAction" })) } : {}) };
        events.set(eventId, updated);
        return mapEvent(calendarId, updated);
      },
      delete_event: async ({ eventId }) => {
        if (!events.has(eventId)) throw notFound(`event ${eventId}`);
        events.delete(eventId);
        return { deleted: true as const, eventId };
      },
      find_free_slots: async ({ timeMin, timeMax, durationMinutes, workingHours, maxSlots }) => ({ slots: freeSlots([...events.values()].map((e) => mapEvent("primary", e)).map((e) => ({ start: e.start, end: e.end })), { timeMin, timeMax }, durationMinutes, workingHours, maxSlots) }),
    },
    connect: async (businessId) => mockIntegrationRecord(GOOGLE_CALENDAR_KEY, businessId, { accountLabel: "reid@northwindskincare.com (mock)", scopes: GOOGLE_CALENDAR_SCOPES, config: { email: "reid@northwindskincare.com" } }),
    healthcheck: async () => mockHealth(GOOGLE_CALENDAR_KEY, { events: events.size }),
  });
}

export const googleCalendarMock = createGoogleCalendarMock();
