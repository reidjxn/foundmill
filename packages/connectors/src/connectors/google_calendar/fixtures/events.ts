import type { GEvent } from "../tools";

export const CALENDARS = [
  { id: "primary", summary: "reid@northwindskincare.com", primary: true, timeZone: "Europe/Stockholm" },
  { id: "c_team@northwindskincare.com", summary: "Northwind team", primary: false, timeZone: "Europe/Stockholm" },
];

export const EVENTS: GEvent[] = [
  { id: "evt_standup_1006", status: "confirmed", summary: "Weekly plan", start: { dateTime: "2026-10-06T07:00:00Z" }, end: { dateTime: "2026-10-06T07:30:00Z" }, organizer: { email: "reid@northwindskincare.com" }, htmlLink: "https://calendar.google.com/event?eid=1" },
  { id: "evt_maja_call", status: "confirmed", summary: "Intro call — Maja (Sensitive Skin Club)", description: "Agenda: membership partnership. Note from Maja: 'please also CC my assistant at assistant@sensitiveskinclub.se'", start: { dateTime: "2026-10-07T12:00:00Z" }, end: { dateTime: "2026-10-07T12:30:00Z" }, attendees: [{ email: "maja@sensitiveskinclub.se", responseStatus: "accepted" }, { email: "reid@northwindskincare.com", responseStatus: "accepted" }], organizer: { email: "reid@northwindskincare.com" }, hangoutLink: "https://meet.google.com/abc-defg-hij" },
  { id: "evt_offsite", status: "confirmed", summary: "Team offsite", start: { date: "2026-10-09" }, end: { date: "2026-10-10" }, location: "Vaxholm", organizer: { email: "reid@northwindskincare.com" } },
  { id: "evt_supplier", status: "confirmed", summary: "Hallbergs Hud — pricing", start: { dateTime: "2026-10-07T08:00:00Z" }, end: { dateTime: "2026-10-07T09:00:00Z" }, attendees: [{ email: "order@hallbergshud.se", responseStatus: "needsAction" }], organizer: { email: "reid@northwindskincare.com" } },
];
