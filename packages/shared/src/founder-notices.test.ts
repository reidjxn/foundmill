import { describe, expect, it } from "vitest";
import { cancelLinkWords, founderChangeNote, founderNoticeOf, FORMER_PROJECT_CARD, HARD_SUPPRESSION_REASONS, noticeDay, noticeMoment, rolePhrase } from "./founder-notices";
import { founderNoticeEmail, type FounderNoticeFacts } from "./people-email";
import { usSpelling } from "./us-spelling";

const base: FounderNoticeFacts = { appName: "Foundmill", notice: "role_changed", reader: "founder", recipientName: "Cara", actorName: "Ana Ruiz", subjectName: "Ben Ode", projectName: "Bread by Bike", when: "Nov 13, 2026 at 3:45 PM EST", fromRole: "cofounder", toRole: "member", link: "https://app.foundmill.test/b/x/settings/members" };
const all = (f: FounderNoticeFacts) => {
  const e = founderNoticeEmail(f);
  return `${e.subject}\n${e.text}\n${e.html}`;
};

describe("founderNoticeOf: which notice an audit entry is", () => {
  it("a founder's role below a founder's, a founder's removal, a deletion asked for or canceled; nothing else", () => {
    expect(founderNoticeOf({ action: "team.humans.role", details: { fromRole: "cofounder", role: "member" } })).toBe("role_changed");
    expect(founderNoticeOf({ action: "team.humans.role", details: { fromRole: "owner", role: "admin" } })).toBe("role_changed");
    expect(founderNoticeOf({ action: "team.humans.role", details: { fromRole: "owner", role: "cofounder" } })).toBeNull();
    expect(founderNoticeOf({ action: "team.humans.role", details: { fromRole: "member", role: "viewer" } })).toBeNull();
    expect(founderNoticeOf({ action: "team.humans.role", details: { fromRole: "cofounder", role: null } })).toBeNull();
    expect(founderNoticeOf({ action: "team.humans.remove", details: { role: "member", formerRole: "cofounder" } })).toBe("removed");
    expect(founderNoticeOf({ action: "team.humans.remove", details: { role: "member" } })).toBeNull();
    expect(founderNoticeOf({ action: "business.request_deletion", details: {} })).toBe("deletion_requested");
    expect(founderNoticeOf({ action: "business.cancel_deletion", details: {} })).toBe("deletion_canceled");
    expect(founderNoticeOf({ action: "business.export", details: {} })).toBeNull();
  });
});

describe("the dates: US, 12-hour, the reader's zone", () => {
  it("reads in the zone given, UTC for none or a zone that does not exist", () => {
    const at = new Date("2026-11-13T20:45:00Z");
    expect(noticeMoment(at, "America/New_York")).toBe("Nov 13, 2026 at 3:45 PM EST");
    expect(noticeMoment(at, null)).toBe("Nov 13, 2026 at 8:45 PM UTC");
    expect(noticeMoment(at, "Mars/Olympus")).toBe("Nov 13, 2026 at 8:45 PM UTC");
    expect(noticeDay(at, "Asia/Tokyo")).toBe("Nov 14, 2026");
  });
});

describe("founderNoticeEmail", () => {
  it("names who did what and when, and what the reader can do; no off link, and the footer says why", () => {
    const e = founderNoticeEmail(base);
    expect(e.subject).toBe("Ana Ruiz changed Ben Ode's role in Bread by Bike");
    expect(e.text).toContain("Ana Ruiz changed Ben Ode's role in Bread by Bike from a cofounder to a member on Nov 13, 2026 at 3:45 PM EST.");
    expect(e.text).toContain("Open People: https://app.foundmill.test/b/x/settings/members");
    expect(e.text).not.toMatch(/Turn these emails off|Pause every email|unsubscribe/i);
    expect(e.text).toContain("always reach its founders, whatever your email settings say");
    const toBen = founderNoticeEmail({ ...base, reader: "subject", recipientName: "Ben" });
    expect(toBen.subject).toBe("Your role in Bread by Bike changed");
    expect(toBen.text).toContain("If you didn't expect this, talk it over with the other founders.");
  });

  it("the removed founder: what happened, that the rest of their account is untouched, and the cancel while a deletion waits", () => {
    const removed = founderNoticeEmail({ ...base, notice: "removed", reader: "subject", fromRole: "owner", toRole: null, link: null });
    expect(removed.subject).toBe("You were removed from Bread by Bike");
    expect(removed.text).toContain("You were a founder.");
    expect(removed.text).not.toContain(FORMER_PROJECT_CARD.button);
    const withCancel = founderNoticeEmail({ ...base, notice: "removed", reader: "subject", link: null, scheduledFor: "Nov 20, 2026", cancel: { link: "https://app.foundmill.test/a/TOKEN", until: "Nov 20, 2026 at 3:45 PM EST" } });
    expect(withCancel.text).toContain("Cancel the deletion: https://app.foundmill.test/a/TOKEN");
    expect(withCancel.text).toContain("Bread by Bike is set to be deleted on Nov 20, 2026. You can cancel the deletion until Nov 20, 2026 at 3:45 PM EST.");
    expect(withCancel.text).toContain("It does not give you your place back");
  });

  it("a deletion: the founders get the Danger zone, a former founder the cancel or the way to ask; a cancel says who", () => {
    const toFounder = founderNoticeEmail({ ...base, notice: "deletion_requested", subjectName: null, scheduledFor: "Nov 20, 2026", link: "https://app.foundmill.test/b/x/settings/danger" });
    expect(toFounder.subject).toBe("Ana Ruiz asked to delete Bread by Bike");
    expect(toFounder.text).toContain("It will be deleted on Nov 20, 2026 unless a founder cancels.");
    expect(toFounder.text).toContain("Open the Danger zone: https://app.foundmill.test/b/x/settings/danger");
    const former = founderNoticeEmail({ ...base, notice: "deletion_requested", reader: "former", subjectName: null, link: null, scheduledFor: "Nov 20, 2026" });
    expect(former.text).toContain("ask one of the founders to cancel it");
    const canceled = founderNoticeEmail({ ...base, notice: "deletion_canceled", actorName: "Ben Ode", subjectName: null, actorFormerUntil: "Nov 12, 2026" });
    expect(canceled.subject).toBe("Ben Ode canceled the deletion of Bread by Bike");
    expect(canceled.text).toContain("Ben Ode, a founder of Bread by Bike until Nov 12, 2026, canceled the permanent deletion");
    expect(canceled.text).toContain("Canceling gave them nothing else: they are still out of the project.");
  });

  it("renders names safely: no link, no address, no markup from a name reaches the email", () => {
    const f = { ...base, actorName: 'Ana <script>x</script> "R"', subjectName: "Ben https://evil.example/pay ben@evil.example", projectName: "Bread evil.example" };
    const text = all(f);
    expect(text).not.toContain("evil.example");
    // The HTML part escapes every name; the plain-text part and the subject are text, which no client renders as markup.
    expect(founderNoticeEmail(f).html).not.toContain("<script>");
    expect(founderNoticeEmail(f).html).toContain("&lt;script&gt;");
    expect(text).toContain("(link)");
    expect(text).toContain("(address)");
    const unnamed = founderNoticeEmail({ ...base, actorName: null, subjectName: null, recipientName: null });
    expect(unnamed.subject).toBe("One of the founders changed a founder's role in Bread by Bike");
    expect(unnamed.text.startsWith("Hi,")).toBe(true);
  });

  it("US English everywhere, and never a word about being on one's own or about jobs", () => {
    const variants: FounderNoticeFacts[] = [];
    for (const notice of ["role_changed", "removed", "deletion_requested", "deletion_canceled"] as const)
      for (const reader of ["founder", "subject", "former"] as const) variants.push({ ...base, notice, reader, scheduledFor: "Nov 20, 2026", cancel: reader === "founder" ? null : { link: "https://x.test/a/T", until: "Nov 20, 2026" } });
    for (const f of variants) {
      const text = founderNoticeEmail(f).text;
      expect(usSpelling(text), `${f.notice}/${f.reader}`).toBe(text);
      expect(text, `${f.notice}/${f.reader}`).not.toMatch(/\b(solo|alone|on your own|by yourself|need a cofounder|job|career|employ)/i);
    }
  });
});

describe("the other words", () => {
  it("the Inbox note, the card, the cancel page, the role phrases and the hard suppressions", () => {
    expect(founderChangeNote({ notice: "role_changed", actorName: "Ana Ruiz", subjectName: "Ben Ode", fromRole: "cofounder", toRole: "member", when: "Nov 13, 2026 at 3:45 PM EST" })).toEqual({
      subject: "Ana Ruiz changed Ben Ode's role",
      body: "Ana Ruiz changed Ben Ode's role from a cofounder to a member on Nov 13, 2026 at 3:45 PM EST. If this wasn't agreed, a founder can change it back in Settings › People.",
    });
    expect(founderChangeNote({ notice: "removed", actorName: null, subjectName: null, fromRole: "owner", when: "Nov 13, 2026" }).subject).toBe("One of the founders removed a founder");
    expect(FORMER_PROJECT_CARD.title("Bread by Bike")).toBe("Bread by Bike is set to be deleted");
    expect(cancelLinkWords("expired").description).toMatch(/7 days/);
    expect(rolePhrase("admin")).toBe("an admin");
    expect(HARD_SUPPRESSION_REASONS).toEqual(["bounced", "marked the message as spam"]);
  });
});
