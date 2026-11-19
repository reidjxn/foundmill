/** Live Google Calendar connector (REST v3) with per-business OAuth. */
import { uuid } from "@foundmill/shared";
import type { Connector, ToolContext } from "../../contract";
import { buildLiveConnector, healthResult } from "../../define";
import { createHttp, type HttpClient } from "../../http";
import { resolveLiveOptions, type LiveConnectorOptions } from "../../platform";
import { googleAccessToken, googleHeaders, googleOAuthConnect } from "../_shared/google-auth";
import { googleCalendarMock } from "./mock";
import { CALENDAR_BASE_URL, freeSlots, GOOGLE_CALENDAR_KEY, GOOGLE_CALENDAR_RATE_LIMITS, GOOGLE_CALENDAR_SCOPES, googleCalendarTools, mapEvent, type GEvent } from "./tools";

export function createGoogleCalendarConnector(options: LiveConnectorOptions = {}): Connector {
  const { secrets, fetch, now } = resolveLiveOptions(options);
  const deps = { connectorKey: GOOGLE_CALENDAR_KEY, secrets, fetch, now };
  const client = async (ctx: ToolContext): Promise<HttpClient> => createHttp({ connectorKey: GOOGLE_CALENDAR_KEY, baseUrl: CALENDAR_BASE_URL, fetch, headers: googleHeaders((await googleAccessToken(ctx, deps)).accessToken) });
  const cal = (id: string) => encodeURIComponent(id);

  return buildLiveConnector(
    {
      key: GOOGLE_CALENDAR_KEY,
      displayName: "Google Calendar",
      phase: 1,
      auth: { kind: "oauth", scopes: GOOGLE_CALENDAR_SCOPES, authorizationCode: true },
      tools: googleCalendarTools,
      rateLimits: GOOGLE_CALENDAR_RATE_LIMITS,
      now,
      handlers: {
        list_calendars: async (_a, ctx) => ({ items: ((await (await client(ctx)).json<{ items?: { id: string; summary: string; primary?: boolean; timeZone?: string }[] }>("GET", "/users/me/calendarList")).items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: c.primary ?? false, timeZone: c.timeZone ?? null })) }),
        list_events: async ({ calendarId, timeMin, timeMax, maxResults, q }, ctx) => ({ items: ((await (await client(ctx)).json<{ items?: GEvent[] }>("GET", `/calendars/${cal(calendarId)}/events`, { query: { timeMin, timeMax, maxResults, q, singleEvents: true, orderBy: "startTime" } })).items ?? []).map((e) => mapEvent(calendarId, e)) }),
        get_event: async ({ calendarId, eventId }, ctx) => mapEvent(calendarId, await (await client(ctx)).json<GEvent>("GET", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`)),
        create_event: async ({ calendarId, summary, description, location, start, end, timeZone, attendees, addMeetLink, sendUpdates }, ctx) => {
          const body = { summary, description, location, start: { dateTime: start, timeZone }, end: { dateTime: end, timeZone }, attendees: attendees.map((email) => ({ email })), ...(addMeetLink ? { conferenceData: { createRequest: { requestId: uuid(), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}) };
          return mapEvent(calendarId, await (await client(ctx)).json<GEvent>("POST", `/calendars/${cal(calendarId)}/events`, { query: { sendUpdates, conferenceDataVersion: addMeetLink ? 1 : 0 }, body }));
        },
        add_event: async ({ calendarId, summary, description, location, start, end, timeZone }, ctx) =>
          mapEvent(calendarId, await (await client(ctx)).json<GEvent>("POST", `/calendars/${cal(calendarId)}/events`, { query: { sendUpdates: "none" }, body: { summary, description, location, start: { dateTime: start, timeZone }, end: { dateTime: end, timeZone } } })),
        update_event: async ({ calendarId, eventId, attendees, start, end, sendUpdates, ...patch }, ctx) => {
          const body = { ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), ...(start ? { start: { dateTime: start } } : {}), ...(end ? { end: { dateTime: end } } : {}), ...(attendees ? { attendees: attendees.map((email) => ({ email })) } : {}) };
          return mapEvent(calendarId, await (await client(ctx)).json<GEvent>("PATCH", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, { query: { sendUpdates }, body }));
        },
        delete_event: async ({ calendarId, eventId, sendUpdates }, ctx) => {
          await (await client(ctx)).raw("DELETE", `/calendars/${cal(calendarId)}/events/${encodeURIComponent(eventId)}`, { query: { sendUpdates } });
          return { deleted: true as const, eventId };
        },
        find_free_slots: async ({ calendarId, timeMin, timeMax, durationMinutes, workingHours, maxSlots }, ctx) => {
          const res = await (await client(ctx)).json<{ calendars?: Record<string, { busy?: { start: string; end: string }[] }> }>("POST", "/freeBusy", { body: { timeMin, timeMax, items: [{ id: calendarId }] } });
          return { slots: freeSlots(res.calendars?.[calendarId]?.busy ?? [], { timeMin, timeMax }, durationMinutes, workingHours, maxSlots) };
        },
      },
      connect: (businessId, input) => googleOAuthConnect(input, deps, { businessId, scopes: GOOGLE_CALENDAR_SCOPES, label: "Google Calendar", newId: uuid }),
      healthcheck: async (integration) => {
        const startedAt = now().getTime();
        if (!secrets.googleClientId || !secrets.googleClientSecret) return healthResult("disconnected", startedAt, { now, message: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured" });
        return healthResult(integration.status === "mock" ? "connected" : integration.status, startedAt, { now });
      },
    },
    googleCalendarMock,
  );
}

export { googleCalendarMock, createGoogleCalendarMock } from "./mock";
export { googleCalendarTools, GOOGLE_CALENDAR_KEY } from "./tools";
