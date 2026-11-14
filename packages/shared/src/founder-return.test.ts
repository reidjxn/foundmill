import { describe, expect, it } from "vitest";
import { ACCOUNT_SAFETY_EMAIL_KINDS, DEFAULT_EMAIL_NOTIFICATION_PREFS, EMAIL_NOTIFICATION_KINDS, LIMITED_EMAIL_KINDS } from "./constants";
import { FOUNDER_NOTIFICATION_KINDS, notificationLinkParams, oneClickOption } from "./founder-notifications";
import { EMAIL_NOTIFICATION_HINTS, EMAIL_NOTIFICATION_LABELS, NOTIFY_HOLDING_WAIT_MS, NOTIFY_PER_PERSON_PER_DAY, NOTIFY_WAIT_MS } from "./notify-email";
import { addDaysToKey, founderActivation, founderHabit, isPresent, PRESENCE, startsNewSession } from "./founder-return";
import { usSpelling } from "./us-spelling";

const at = (h: number) => new Date(Date.UTC(2026, 10, 10, 9) + h * 3_600_000);

describe("sessions and presence", () => {
  it("starts a session on the first ping and after a gap longer than 30 minutes", () => {
    expect(startsNewSession(null, 0)).toBe(true);
    expect(startsNewSession(0, PRESENCE.sessionGapMs)).toBe(false);
    expect(startsNewSession(0, PRESENCE.sessionGapMs + 1)).toBe(true);
  });
  it("counts the founder as present for ten minutes after a ping", () => {
    expect(isPresent(null, 0)).toBe(false);
    expect(isPresent(0, PRESENCE.presentWindowMs)).toBe(true);
    expect(isPresent(0, PRESENCE.presentWindowMs + 1)).toBe(false);
  });
});

describe("founderActivation", () => {
  const done = { committedAt: at(0), specificationSignedOffAt: at(1), roadmapSignedOffAt: at(2), firstFounderContinueAt: at(3) };
  it("is activated when all three steps land within 24 hours of commit, at the last of them", () => {
    expect(founderActivation(done)).toEqual({ activated: true, activatedAt: at(3), missing: [] });
  });
  it("names what is missing, in the order a founder meets it", () => {
    expect(founderActivation({ ...done, roadmapSignedOffAt: null, firstFounderContinueAt: null }).missing).toEqual(["roadmap", "continue"]);
  });
  it("does not count a step that came after the window", () => {
    expect(founderActivation({ ...done, firstFounderContinueAt: at(25) })).toMatchObject({ activated: false, missing: ["continue"] });
  });
  it("is never activated without a commit", () => {
    expect(founderActivation({ ...done, committedAt: null }).activated).toBe(false);
  });
});

describe("founderHabit", () => {
  it("counts distinct return days in the seven days after the commit day", () => {
    expect(founderHabit("2026-11-10", ["2026-11-10", "2026-11-11", "2026-11-11", "2026-11-13", "2026-11-17", "2026-11-18"])).toEqual({ habit: true, returnDays: ["2026-11-11", "2026-11-13", "2026-11-17"] });
  });
  it("needs three return days", () => {
    expect(founderHabit("2026-11-10", ["2026-11-10", "2026-11-12", "2026-11-14"]).habit).toBe(false);
  });
  it("adds days across a month end", () => {
    expect(addDaysToKey("2026-11-28", 7)).toBe("2026-12-05");
  });
});

describe("founder notifications on the platform's one sender (founder, 2026-11-12)", () => {
  it("are the platform's kinds and the account-safety notice, every switch on until turned off", () => {
    expect([...FOUNDER_NOTIFICATION_KINDS]).toEqual([...EMAIL_NOTIFICATION_KINDS, ...ACCOUNT_SAFETY_EMAIL_KINDS]);
    expect(Object.keys(DEFAULT_EMAIL_NOTIFICATION_PREFS)).not.toContain("founder_notice");
    expect(Object.values(DEFAULT_EMAIL_NOTIFICATION_PREFS).every(Boolean)).toBe(true);
    expect(Object.keys(DEFAULT_EMAIL_NOTIFICATION_PREFS).sort()).toEqual([...EMAIL_NOTIFICATION_KINDS].sort());
  });
  it("keep the founder's numbers: 30 minutes when work is held up, a day otherwise, three a day with the briefs aside", () => {
    expect(NOTIFY_HOLDING_WAIT_MS).toBe(30 * 60_000);
    expect(NOTIFY_WAIT_MS).toBe(24 * 3_600_000);
    expect(NOTIFY_PER_PERSON_PER_DAY).toBe(3);
    expect(LIMITED_EMAIL_KINDS).not.toContain("daily_brief");
    expect(LIMITED_EMAIL_KINDS).not.toContain("weekly_review");
    // The note that someone a person invited joined answers what they did: it never uses up their three a day.
    expect(LIMITED_EMAIL_KINDS).not.toContain("invitation_accepted");
  });
  it("label every kind in US English", () => {
    for (const k of EMAIL_NOTIFICATION_KINDS) {
      const words = `${EMAIL_NOTIFICATION_LABELS[k]} ${EMAIL_NOTIFICATION_HINTS[k]}`;
      expect(usSpelling(words), k).toBe(words);
    }
  });
  it("tags a link with where the founder came from", () => {
    expect(notificationLinkParams("n1")).toBe("via=email&n=n1");
  });
});

describe("oneClickOption", () => {
  const opt = (o: Record<string, unknown>) => ({ id: "a", label: "Do it", recommended: true, reversible: true, cost_minor: 0, consequence: "It happens.", ...o });
  const item = (options: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({ type: "decision", state: "unread", decision: { options }, ...extra });
  it("offers the single recommended, reversible, free option", () => {
    expect(oneClickOption(item([opt({}), opt({ id: "b", recommended: false })]), { isSignoff: false })).toEqual({ id: "a", label: "Do it", consequence: "It happens." });
  });
  it("never offers an irreversible, paid, unrecommended or ambiguous option", () => {
    expect(oneClickOption(item([opt({ reversible: false })]), { isSignoff: false })).toBeNull();
    expect(oneClickOption(item([opt({ reversible: undefined })]), { isSignoff: false })).toBeNull();
    expect(oneClickOption(item([opt({ cost_minor: 500 })]), { isSignoff: false })).toBeNull();
    expect(oneClickOption(item([opt({ recommended: false })]), { isSignoff: false })).toBeNull();
    expect(oneClickOption(item([opt({}), opt({ id: "b" })]), { isSignoff: false })).toBeNull();
  });
  it("never offers an option whose own actions spend, contact someone or hire", () => {
    expect(oneClickOption(item([opt({ actions: [{ type: "create_task" }] })]), { isSignoff: false })).not.toBeNull();
    for (const type of ["send_message", "set_budget", "approve_spend", "enable_channel", "hire_agent", "request_human_action"]) expect(oneClickOption(item([opt({ actions: [{ type: "create_task" }, { type }] })]), { isSignoff: false }), type).toBeNull();
  });
  it("never offers an approval, a sign-off, an answered note or another type", () => {
    expect(oneClickOption(item([opt({ id: "reject_request" }), opt({ id: "approve_request", recommended: false })]), { isSignoff: false })).toBeNull();
    expect(oneClickOption(item([opt({})]), { isSignoff: true })).toBeNull();
    expect(oneClickOption(item([opt({})], { state: "answered" }), { isSignoff: false })).toBeNull();
    expect(oneClickOption(item([opt({})], { type: "warning" }), { isSignoff: false })).toBeNull();
  });
});
