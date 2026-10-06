import { describe, expect, it } from "vitest";
import { jsonResponse, routedFetch } from "../../http";
import { isUntrusted } from "../../quarantine";
import { describeConnectorContract, makeToolContext } from "../../testing/contract-suite";
import { EVENTS } from "./fixtures/events";
import { createGoogleCalendarConnector } from "./index";
import { createGoogleCalendarMock, googleCalendarMock } from "./mock";
import { freeSlots } from "./tools";

const WEEK = { timeMin: "2026-10-05T00:00:00Z", timeMax: "2026-10-12T00:00:00Z" };

describeConnectorContract("google_calendar (mock)", {
  connector: googleCalendarMock,
  mode: "mock",
  calls: [
    { tool: "list_calendars", args: {} },
    { tool: "list_events", args: WEEK, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: { id: string }[] }).items.map((e) => e.id)).toEqual(["evt_standup_1006", "evt_supplier", "evt_maja_call", "evt_offsite"]) },
    { tool: "list_events", args: { ...WEEK, q: "maja" }, check: (r) => expect(isUntrusted(r.data) && (r.data.content as { items: unknown[] }).items).toHaveLength(1) },
    { tool: "get_event", args: { eventId: "evt_offsite" }, check: (r) => expect(isUntrusted(r.data) && r.data.content).toMatchObject({ allDay: true, location: "Vaxholm" }) },
    { tool: "create_event", args: { summary: "Demo with Ledgerly", start: "2026-10-08T13:00:00Z", end: "2026-10-08T13:30:00Z", attendees: ["sara@ledgerly.app"], addMeetLink: true }, check: (r) => expect(r.data).toMatchObject({ attendees: [{ email: "sara@ledgerly.app", responseStatus: "needsAction" }], meetLink: expect.stringContaining("meet.google.com") }) },
    { tool: "create_event", args: { summary: "Backwards", start: "2026-10-08T13:00:00Z", end: "2026-10-08T12:00:00Z" }, expectOk: false, check: (r) => expect(r.error?.code).toBe("invalid_args") },
    { tool: "find_free_slots", args: { timeMin: "2026-10-07T06:00:00Z", timeMax: "2026-10-07T18:00:00Z", durationMinutes: 60 }, check: (r) => expect((r.data as { slots: { start: string }[] }).slots[0]).toEqual({ start: "2026-10-07T09:00:00.000Z", end: "2026-10-07T10:00:00.000Z" }) },
  ],
});

describe("google_calendar slot finder", () => {
  it("skips busy intervals, weekends and out-of-hours time", () => {
    const slots = freeSlots([{ start: "2026-10-09T09:00:00Z", end: "2026-10-09T12:00:00Z" }], { timeMin: "2026-10-09T08:00:00Z", timeMax: "2026-10-13T00:00:00Z" }, 60, { startHour: 9, endHour: 17 }, 20);
    expect(slots[0]).toEqual({ start: "2026-10-09T12:00:00.000Z", end: "2026-10-09T13:00:00.000Z" });
    expect(slots.some((s) => s.start.startsWith("2026-10-10") || s.start.startsWith("2026-10-11"))).toBe(false);
    expect(slots.some((s) => s.start.startsWith("2026-10-12T09"))).toBe(true);
  });
  it("updates and deletes events in memory", async () => {
    const mock = createGoogleCalendarMock();
    const ctx = makeToolContext(mock);
    const upd = await mock.callTool("update_event", { eventId: "evt_supplier", summary: "Hallbergs Hud — pricing (moved)", start: "2026-10-07T10:00:00Z", end: "2026-10-07T11:00:00Z" }, ctx);
    expect(upd.data).toMatchObject({ summary: "Hallbergs Hud — pricing (moved)", start: "2026-10-07T10:00:00.000Z" });
    expect((await mock.callTool("delete_event", { eventId: "evt_supplier" }, ctx)).data).toEqual({ deleted: true, eventId: "evt_supplier" });
    expect((await mock.callTool("get_event", { eventId: "evt_supplier" }, ctx)).error?.code).toBe("not_found");
  });
});

describe("google_calendar live (canned)", () => {
  it("creates an event with sendUpdates and a Meet link request", async () => {
    const connector = createGoogleCalendarConnector({
      secrets: {},
      fetch: routedFetch({
        "POST https://www.googleapis.com/calendar/v3/calendars/primary/events": async (req, url) => {
          expect(url.searchParams.get("sendUpdates")).toBe("all");
          expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
          const body = (await req.json()) as { attendees: { email: string }[]; conferenceData: unknown };
          expect(body.attendees).toEqual([{ email: "maja@sensitiveskinclub.se" }]);
          expect(body.conferenceData).toBeDefined();
          return jsonResponse({ ...EVENTS[1], id: "new1" });
        },
      }),
    });
    const r = await connector.callTool("create_event", { summary: "Call", start: "2026-10-07T12:00:00Z", end: "2026-10-07T12:30:00Z", attendees: ["maja@sensitiveskinclub.se"], addMeetLink: true }, makeToolContext(connector, { mode: "live", credential: { kind: "oauth", secret: "tok" } }));
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ id: "new1", meetLink: "https://meet.google.com/abc-defg-hij" });
  });
});
