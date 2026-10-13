import { describe, expect, it } from "vitest";
import { generateJourneyFixture } from "@foundmill/dugout/components/journey/fixtures";
import { EXAMPLE_IDS, loadExample } from "../examples";
import { JOURNEY_DAYS, STORY_DAY, currentChapter, datedCustomerUpdate, datedMilestones, exampleChapters, exampleJourney, shiftDay, storyOffset, storyText } from "../examples/helpers";
import { TUTORLANE } from "../examples/tutorlane";

const businesses = await Promise.all(EXAMPLE_IDS.map(loadExample));
const dayOf = (iso: string | null | undefined) => (iso ?? "").slice(0, 10);

describe("moving a story to today", () => {
  it("counts and moves whole days across months and years, keeping the time of day", () => {
    expect(storyOffset(STORY_DAY)).toBe(0);
    expect(storyOffset("2026-10-12")).toBe(5);
    expect(storyOffset("2027-10-07")).toBe(365);
    expect(shiftDay("2026-09-28", 5)).toBe("2026-10-03");
    expect(shiftDay("2026-12-30T12:00:00", 5)).toBe("2027-01-04T12:00:00");
    expect(shiftDay("2024-10-08T07:05:00.000Z", -10)).toBe("2024-09-28T07:05:00.000Z");
  });

  it("prints a token's date and keeps its weekday true to the moved date", () => {
    expect(storyText("{weekday:2026-09-20}, {date:2026-09-20}", 0)).toBe("Sunday, Sep 20");
    expect(storyText("{weekday:2026-09-20}, {date:2026-09-20}", 5)).toBe("Friday, Sep 25");
    expect(storyText("By {weekday:2026-10-02}.", 30)).toBe("By Sunday.");
    expect(storyText("No tokens here.", 30)).toBe("No tokens here.");
  });

  it("leaves no token unresolved in any Customer Update", () => {
    for (const b of businesses) {
      const u = datedCustomerUpdate(b, "2027-03-01");
      for (const text of [...u.customer.facts.map((f) => f.value), ...u.commentary.map((c) => c.text)]) expect(text, b.identity.id).not.toMatch(/\{(date|weekday):/);
    }
    expect(datedCustomerUpdate(TUTORLANE, "2026-10-12").commentary[0]!.text).toContain("on a Friday evening");
  });

  it("builds the same chapters as the design system's fixture on the story's day", () => {
    const fixture = generateJourneyFixture({ days: JOURNEY_DAYS });
    expect(exampleChapters(STORY_DAY, fixture.chapters.map((c) => c.title))).toEqual(fixture.chapters);
    expect(currentChapter(STORY_DAY)).toBe("Chapter 9");
  });

  it("keeps chapters on calendar quarters wherever today falls", () => {
    for (const today of ["2026-10-12", "2027-01-01", "2027-02-28", "2027-06-30"]) {
      const chapters = exampleChapters(today);
      expect(chapters.filter((c) => c.status === "current"), today).toHaveLength(1);
      const current = chapters.find((c) => c.status === "current")!;
      expect(current.startsOn <= today && today <= current.endsOn, today).toBe(true);
      for (const c of chapters) expect(c.startsOn.slice(5), today).toMatch(/^(01|04|07|10)-01$/);
      expect(chapters[0]!.startsOn <= shiftDay(today, -(JOURNEY_DAYS - 1)), today).toBe(true);
    }
  });

  for (const b of businesses) {
    describe(b.identity.name, () => {
      const today = "2026-10-12";
      const story = exampleJourney(b);
      const moved = exampleJourney(b, today);

      it("ends the Journey today and moves every date by the same days", () => {
        expect(moved.today).toBe(today);
        expect(moved.kickoff).toBe(shiftDay(today, -(JOURNEY_DAYS - 1)));
        expect(moved.rows.at(-1)!.day).toBe(today);
        expect(moved.forecast[0]!.day).toBe(shiftDay(today, 1));
        expect(moved.rows.map((r) => r.day)).toEqual(story.rows.map((r) => shiftDay(r.day, 5)));
        expect(moved.conversions.map((c) => c.occurredAt)).toEqual(story.conversions.map((c) => shiftDay(c.occurredAt, 5)));
        expect(moved.milestones.map((m) => m.achievedAt)).toEqual(story.milestones.map((m) => shiftDay(m.achievedAt, 5)));
        expect(moved.roadmap.map((r) => r.plannedOn)).toEqual(story.roadmap.map((r) => shiftDay(r.plannedOn, 5)));
        // The figures themselves do not change.
        expect(moved.rows.map((r) => r.revenueMinor)).toEqual(story.rows.map((r) => r.revenueMinor));
        expect(moved.ledger.payments.map((p) => p.occurredAt)).toEqual(story.ledger.payments.map((p) => shiftDay(p.occurredAt, 5)));
      });

      it("keeps every milestone card on its pin's day, and every pin's payment on that day", () => {
        const pins = new Map(moved.milestones.map((m) => [m.label, m]));
        for (const card of datedMilestones(b, today)) {
          const pin = pins.get(card.label);
          if (pin) expect(dayOf(pin.achievedAt), card.label).toBe(dayOf(card.achievedAt));
        }
        const byId = new Map(moved.conversions.map((c) => [c.id, c]));
        for (const m of moved.milestones) if (m.ref) expect(dayOf(byId.get(String(m.ref.conversionId))?.occurredAt), m.label).toBe(dayOf(m.achievedAt));
      });

      it("names the Customer Update's customer on the day its moved first touch and days to convert give", () => {
        const u = datedCustomerUpdate(b, today);
        const firstSeen = u.customer.facts.find((f) => f.label === "First seen")!.value;
        const paid = moved.conversions.find((c) => c.entityName === u.customer.name)!;
        const seen = new Date(`${firstSeen}, 2026 12:00:00 UTC`);
        expect(dayOf(paid.occurredAt)).toBe(shiftDay(seen.toISOString(), u.stats.days).slice(0, 10));
      });
    });
  }
});
