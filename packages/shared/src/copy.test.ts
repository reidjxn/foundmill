import { describe, expect, it } from "vitest";
import { countOf, endSentence, formatCount, indefiniteArticle, notePreview, usDate, withArticle } from "./copy";

describe("counts", () => {
  it("group en-US and agree with their noun", () => {
    expect(formatCount(1674)).toBe("1,674");
    expect(countOf(1, "month")).toBe("1 month");
    expect(countOf(24, "month")).toBe("24 months");
    expect(countOf(1674, "order")).toBe("1,674 orders");
    expect(countOf(0, "account")).toBe("0 accounts");
    expect(countOf(1, "business", "businesses")).toBe("1 business");
    expect(countOf(3, "business", "businesses")).toBe("3 businesses");
  });
});

describe("usDate", () => {
  it("prints month first in UTC, with or without the year", () => {
    expect(usDate("2026-10-18T23:30:00.000Z")).toBe("Oct 18, 2026");
    expect(usDate(new Date(Date.UTC(2026, 9, 11)), { year: false })).toBe("Oct 11");
    expect(usDate(Date.UTC(2027, 0, 2))).toBe("Jan 2, 2027");
  });
});

describe("articles", () => {
  it("pick a or an by sound", () => {
    expect(withArticle("Email automation")).toBe("an Email automation");
    expect(withArticle("ops")).toBe("an ops");
    expect(withArticle("Lead generation")).toBe("a Lead generation");
    expect(withArticle("SEO")).toBe("an SEO");
    expect(withArticle("CRM")).toBe("a CRM");
    expect(indefiniteArticle("user interview")).toBe("a");
    expect(indefiniteArticle("hour")).toBe("an");
    expect(indefiniteArticle("")).toBe("a");
  });
});

describe("notePreview", () => {
  it("reads the first real sentence, skipping a leading heading but not a bold word that opens a sentence", () => {
    expect(notePreview("**Vision.** We sell month-end close software to small finance teams. More later.")).toBe("We sell month-end close software to small finance teams.");
    expect(notePreview("**Vision**\nWe sell to small finance teams.")).toBe("We sell to small finance teams.");
    expect(notePreview("**Why:** CPA is low. Next.")).toBe("CPA is low.");
    expect(notePreview("# Weekly report\nRevenue is up. Costs are flat.")).toBe("Revenue is up.");
    expect(notePreview("**Atlas** needs a yes. The migration touches [[ent:x|Nordic]] data.")).toBe("Atlas needs a yes.");
    expect(notePreview("We need **€500** for [[ent:00000000-0000-4000-8000-00000000aaaa|LinkedIn]] ads. Why: CPA is low.")).toBe("We need €500 for LinkedIn ads.");
    // A note that is only a heading still previews it.
    expect(notePreview("**No full stop here**")).toBe("No full stop here");
    expect(notePreview("**Vision.**")).toBe("Vision.");
    expect(notePreview("x".repeat(200))).toHaveLength(120);
  });
});

describe("endSentence", () => {
  it("adds a period only when the sentence has no closing mark", () => {
    expect(endSentence("Decided")).toBe("Decided.");
    expect(endSentence("Where should the first customer come from?")).toBe("Where should the first customer come from?");
    expect(endSentence("Done.")).toBe("Done.");
    expect(endSentence('He said "go."')).toBe('He said "go."');
    expect(endSentence("Ship it! ")).toBe("Ship it!");
  });
});
