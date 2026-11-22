/**
 * Booking and the founder's Google Calendar (founder, Nov 22, 2026), only when the founder switched it on in the
 * booking setup and `google_calendar` is connected. Every call goes through the gateway as the Chief of Staff, on the
 * founder's own Google account:
 *
 * - **Busy times** (`list_events` on the primary calendar): an event is busy from its start to its end; all-day and
 *   canceled events are not. The calendar's text is untrusted and never read here: only `id`, `start`, `end`, `allDay`
 *   and `status`. An event booking wrote itself (its id is on a booking) is skipped, because the bookings table is the
 *   truth for that time. A calendar that cannot be read answers null and the caller offers no slot (fail closed: a
 *   busy calendar time is never offered).
 * - **A confirmed booking** (`add_event`: the founder's own calendar, no attendees, nobody invited or notified). It
 *   has no Meet link: only `create_event` can add one, and that tool invites people and asks the founder first.
 * - **A canceled or moved booking** leaves its event where it is: `delete_event` and `update_event` ask the founder
 *   first (policy `founder-google-send-asks`), and booking never waits on an approval. The founder's note says so.
 */
import { repos, type Executor } from "@foundmill/db";
import type { BusyRange } from "@foundmill/shared/booking";
import type { Context } from "../context";

export const BOOKING_CALENDAR_CONNECTOR = "google_calendar";
/** `list_events` answers at most this many events; a window that fills it may hide more, so it is read as unreadable. */
const LIST_MAX = 250;
const WINDOW_MS = 7 * 86_400_000;

export type CalendarContext = Pick<Context, "db" | "gateway" | "log">;

export async function calendarConnected(db: Executor, businessId: string): Promise<boolean> {
  const rows = await repos.integrations.connectionStatuses(db, businessId, [BOOKING_CALENDAR_CONNECTOR]);
  return rows.some((r) => r.status === "connected" || r.status === "degraded");
}

/** The busy ranges in a `list_events` answer, or null when the answer is not a list of events with readable times. */
export function busyFromEvents(items: unknown, ownEventIds: ReadonlySet<string> = new Set()): BusyRange[] | null {
  if (!Array.isArray(items)) return null;
  const out: BusyRange[] = [];
  for (const item of items as { id?: unknown; start?: unknown; end?: unknown; allDay?: unknown; status?: unknown }[]) {
    if (!item || typeof item !== "object") return null;
    if (item.allDay === true || item.status === "cancelled" || (typeof item.id === "string" && ownEventIds.has(item.id))) continue;
    const start = typeof item.start === "string" ? Date.parse(item.start) : NaN;
    const end = typeof item.end === "string" ? Date.parse(item.end) : NaN;
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    if (end > start) out.push({ start: new Date(start), end: new Date(end) });
  }
  return out;
}

async function callAsChief(ctx: CalendarContext, businessId: string, tool: string, args: Record<string, unknown>): Promise<unknown | null> {
  if (!ctx.gateway.toolCall) return null;
  const chief = await repos.agents.chiefOfStaff(ctx.db, businessId);
  if (!chief) return null;
  const out = await ctx.gateway.toolCall({ businessId, agentId: chief.id, connector: BOOKING_CALENDAR_CONNECTOR, tool, args });
  return out.outcome === "allow" && out.result.ok ? (out.result.data ?? null) : null;
}

/**
 * A slot list's calendar read is kept for a minute per project and range (security review, Nov 22, 2026): a visitor
 * paging through times, or a script, never turns into a stream of calls on the founder's Google account. A hold reads
 * the calendar fresh (`fresh`), so what is offered from a minute-old read is still checked before it is held.
 */
const CACHE_MS = 60_000;
const CACHE_MAX = 500;
const cached = new Map<string, { at: number; busy: BusyRange[] }>();
const dayOf = (d: Date) => Math.floor(d.getTime() / 86_400_000);

/** The founder's busy calendar times between `from` and `to`, or null when the calendar could not be read. */
export async function calendarBusy(ctx: CalendarContext, businessId: string, from: Date, to: Date, options: { fresh?: boolean; now?: number } = {}): Promise<BusyRange[] | null> {
  const nowMs = options.now ?? Date.now();
  const key = `${businessId}:${dayOf(from)}:${dayOf(to)}`;
  const hit = options.fresh ? undefined : cached.get(key);
  if (hit && nowMs - hit.at < CACHE_MS) return hit.busy.filter((b) => b.end > from && b.start < to);
  const busy = await readCalendarBusy(ctx, businessId, new Date(dayOf(from) * 86_400_000), new Date((dayOf(to) + 1) * 86_400_000));
  if (busy && !options.fresh) {
    if (cached.size >= CACHE_MAX) cached.clear();
    cached.set(key, { at: nowMs, busy });
  }
  return busy ? busy.filter((b) => b.end > from && b.start < to) : null;
}

/** For tests: forget every kept read. */
export const clearCalendarCache = (): void => cached.clear();

async function readCalendarBusy(ctx: CalendarContext, businessId: string, from: Date, to: Date): Promise<BusyRange[] | null> {
  try {
    const own = new Set(await repos.booking.calendarEventIds(ctx.db, businessId));
    const busy: BusyRange[] = [];
    for (let at = from.getTime(); at < to.getTime(); at += WINDOW_MS) {
      const data = (await callAsChief(ctx, businessId, "list_events", { calendarId: "primary", timeMin: new Date(at).toISOString(), timeMax: new Date(Math.min(at + WINDOW_MS, to.getTime())).toISOString(), maxResults: LIST_MAX })) as { items?: unknown } | null;
      const items = data?.items;
      const ranges = Array.isArray(items) && items.length < LIST_MAX ? busyFromEvents(items, own) : null;
      if (!ranges) {
        ctx.log.warn({ businessId }, "booking: the founder's calendar could not be read, so no slot is offered");
        return null;
      }
      busy.push(...ranges);
    }
    return busy;
  } catch (err) {
    ctx.log.warn({ businessId, err: err instanceof Error ? err.message : String(err) }, "booking: the founder's calendar could not be read, so no slot is offered");
    return null;
  }
}

/** Put a confirmed booking on the founder's own calendar. The event's id, or null when it was not written. */
export async function addCalendarEvent(ctx: CalendarContext, businessId: string, input: { summary: string; start: Date; end: Date; timeZone: string }): Promise<string | null> {
  const data = (await callAsChief(ctx, businessId, "add_event", { calendarId: "primary", summary: input.summary.slice(0, 300), start: input.start.toISOString(), end: input.end.toISOString(), timeZone: input.timeZone })) as { id?: unknown } | null;
  return typeof data?.id === "string" ? data.id : null;
}
