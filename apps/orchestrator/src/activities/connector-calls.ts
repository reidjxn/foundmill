/**
 * The connector calls the orchestrator makes for a business outside any agent session: plan actions that reach a third
 * party (send_message, schedule_meeting) and Door B imports. Tool names and argument shapes are the real ones of
 * packages/connectors (each one is checked against that connector's mock in connector-calls.test.ts), never guessed:
 * a call the gateway cannot run fails before anything reaches a vendor, with a reason the founder can act on.
 */

const EMAIL_RE = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[A-Za-z]{2,}$/;

/** Email addresses named in plan params (a string, a list, or "Name <address>"); a bare name is not an address. */
export function emailsIn(...values: unknown[]): string[] {
  const out = new Set<string>();
  const visit = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(visit);
    if (typeof v !== "string") return;
    for (const part of v.split(/[,;]/)) {
      const candidate = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim().toLowerCase();
      if (EMAIL_RE.test(candidate)) out.add(candidate);
    }
  };
  values.forEach(visit);
  return [...out];
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** What the founder can do when a plan action names a person but no address. */
export const missingAddress = (who: string, action: string) => `${action} needs an email address for ${who || "the recipient"}; add it to their profile or name the address in your reply`;

export interface MessagePlan {
  connector: "gmail" | "sendgrid";
  to: string[];
  subject: string;
  text: string;
}

/**
 * A send_message action as a message: Gmail (the founder's mailbox) unless the action names SendGrid. The planner says
 * who and what (`recipient`, `intent`) and may add `subject` / `body`; an AI disclosure closes the text unless the action
 * says none is needed (BUILD §2.3: an agent never passes itself off as human).
 */
export function messageFor(p: Record<string, unknown>, business: { name: string }): MessagePlan | { error: string } {
  const to = emailsIn(p.to, p.recipient, p.email);
  if (to.length === 0) return { error: missingAddress(text(p.recipient), "Sending the message") };
  const body = text(p.body) || text(p.text) || text(p.intent);
  if (!body) return { error: "Sending the message needs what to say" };
  const subject = (text(p.subject) || text(p.intent) || `A message from ${business.name}`).slice(0, 300);
  const disclosure = p.requires_disclosure === false ? "" : `Sent on behalf of ${business.name} by its AI assistant.`;
  return { connector: p.connector === "sendgrid" ? "sendgrid" : "gmail", to, subject, text: [body, disclosure].filter(Boolean).join("\n\n") };
}

/** gmail.send_message arguments (its `Compose` input). */
export const gmailSendArgs = (m: MessagePlan) => ({ to: m.to, subject: m.subject, text: m.text });

/** sendgrid.send_mail arguments (its `SendMail` input) from one of the account's verified senders. */
export const sendgridSendArgs = (m: MessagePlan, fromEmail: string) => ({ kind: "transactional" as const, from: { email: fromEmail }, to: m.to.map((email) => ({ email })), subject: m.subject, text: m.text });

export interface MeetingPlan {
  summary: string;
  description?: string;
  attendees: string[];
  durationMinutes: number;
  /** Set when the action names the time; otherwise the first free slot in `window` is taken. */
  start?: string;
  end?: string;
  window: { timeMin: string; timeMax: string };
}

const iso = (v: unknown): string | undefined => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined);

/**
 * A schedule_meeting action as a calendar event: `with` / `attendees` must give addresses, the time comes from `start`
 * (and `end`, default 30 minutes later) or the first free slot of the next 7 days (`find_free_slots`).
 */
export function meetingFor(p: Record<string, unknown>, now: Date): MeetingPlan | { error: string } {
  const attendees = emailsIn(p.attendees, p.with, p.to);
  if (attendees.length === 0) return { error: missingAddress(text(p.with), "Scheduling the meeting") };
  const durationMinutes = typeof p.duration_minutes === "number" && p.duration_minutes >= 15 && p.duration_minutes <= 480 ? Math.round(p.duration_minutes) : 30;
  const start = iso(p.start);
  const end = start ? (iso(p.end) ?? new Date(Date.parse(start) + durationMinutes * 60_000).toISOString()) : undefined;
  const summary = (text(p.title) || text(p.topic) || "Meeting").slice(0, 300);
  const description = text(p.description) || text(p.topic);
  const timeMin = new Date(now.getTime() + 60 * 60_000).toISOString();
  const timeMax = new Date(now.getTime() + 7 * 86_400_000).toISOString();
  return { summary, ...(description ? { description: description.slice(0, 5000) } : {}), attendees, durationMinutes, ...(start && end ? { start, end } : {}), window: { timeMin, timeMax } };
}

/** google_calendar.create_event arguments for a meeting with a time. */
export const createEventArgs = (m: MeetingPlan, slot: { start: string; end: string }) => ({ summary: m.summary, ...(m.description ? { description: m.description } : {}), start: slot.start, end: slot.end, attendees: m.attendees, addMeetLink: true });

/** google_calendar.find_free_slots arguments for a meeting without one. */
export const freeSlotArgs = (m: MeetingPlan) => ({ timeMin: m.window.timeMin, timeMax: m.window.timeMax, durationMinutes: m.durationMinutes, maxSlots: 1 });

/** The tool's data from a gateway answer (third-party content arrives as `{ untrusted, content }`), or undefined. */
export function resultData(res: { outcome: string; result?: unknown }): unknown {
  if (res.outcome !== "allow" || !res.result || typeof res.result !== "object") return undefined;
  const data = (res.result as { data?: unknown }).data;
  return data && typeof data === "object" && (data as { untrusted?: unknown }).untrusted === true ? (data as { content?: unknown }).content : data;
}

/** Why an allowed call still failed at the vendor (`result.ok === false`), or null. */
export function resultError(res: { outcome: string; result?: unknown }): string | null {
  if (res.outcome !== "allow" || !res.result || typeof res.result !== "object") return null;
  const r = res.result as { ok?: unknown; error?: { message?: unknown; code?: unknown } };
  if (r.ok !== false) return null;
  return typeof r.error?.message === "string" ? r.error.message : typeof r.error?.code === "string" ? r.error.code : "the tool failed";
}

/** The first verified sender of a `sendgrid.list_verified_senders` answer. */
export function verifiedSenderIn(data: unknown): string | null {
  const items = data && typeof data === "object" ? (data as { items?: unknown }).items : undefined;
  if (!Array.isArray(items)) return null;
  const sender = items.find((s): s is { fromEmail: string } => !!s && typeof s === "object" && (s as { verified?: unknown }).verified === true && typeof (s as { fromEmail?: unknown }).fromEmail === "string");
  return sender?.fromEmail ?? null;
}

/** The first slot of a `google_calendar.find_free_slots` answer. */
export function firstSlotIn(data: unknown): { start: string; end: string } | null {
  const slots = data && typeof data === "object" ? (data as { slots?: unknown }).slots : undefined;
  const slot = Array.isArray(slots) ? slots[0] : undefined;
  return slot && typeof slot === "object" && typeof (slot as { start?: unknown }).start === "string" && typeof (slot as { end?: unknown }).end === "string" ? { start: (slot as { start: string }).start, end: (slot as { end: string }).end } : null;
}

export interface ImportCall {
  connector: "github" | "google_drive" | "stripe" | "opencorporates";
  tool: string;
  args: Record<string, unknown>;
}

/** The read a Door B import source maps to, from its address (and title), or null when no connector reads it. */
export function importCallFor(uri: string, title: string): ImportCall | null {
  const gh = /github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/?#]|$)/.exec(uri);
  if (gh) return { connector: "github", tool: "read_tree", args: { owner: gh[1]!, repo: gh[2]! } };
  if (/docs\.google|drive\.google/.test(uri)) {
    const doc = /\/document\/d\/([A-Za-z0-9_-]{10,})/.exec(uri);
    if (doc) return { connector: "google_drive", tool: "read_doc", args: { documentId: doc[1]! } };
    const q = title.trim() || uri;
    return { connector: "google_drive", tool: "search_files", args: { q: q.slice(0, 300) } };
  }
  if (/stripe/.test(uri)) return { connector: "stripe", tool: "get_account", args: {} };
  if (/companieshouse|opencorporates|bolagsverket/.test(uri)) {
    const q = title.trim();
    return q.length >= 2 ? { connector: "opencorporates", tool: "search_companies", args: { q: q.slice(0, 200) } } : null;
  }
  return null;
}
