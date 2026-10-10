import { describe, expect, it } from "vitest";
import { localNextBestDecisions } from "../services/composer";

/**
 * The in-process composer's no-event fallback (AC-11.3.2) matches the composer service: a next-best decision grounded
 * in the current state, never a "Decision needed: next step · No fresh events" filler note.
 */
describe("localNextBestDecisions", () => {
  it("puts blocked tasks first, then a missing channel, and always ends with the next cycle's focus", () => {
    const all = localNextBestDecisions({ tasks: { blocked: 2, running: 1 }, channelsEnabled: 0, customers30d: 0, signups30d: 0 });
    expect(all.map((d) => d.kind)).toEqual(["unblock_tasks", "start_distribution", "plan_next_cycle"]);
    expect(all[0]).toMatchObject({ title: "Blocked tasks need a call", facts: { blocked_tasks: 2, running_tasks: 1 } });
    for (const d of all) {
      expect(d.options.length).toBeGreaterThanOrEqual(2);
      expect(d.options.filter((o) => o.recommended)).toHaveLength(1);
      expect(d.title).not.toMatch(/\d/);
    }
  });
  it("with nothing blocked and channels live, offers only the next cycle's focus, leaning to distribution once customers arrive", () => {
    const [only, ...rest] = localNextBestDecisions({ tasks: { running: 3, done: 9 }, channelsEnabled: 2, customers30d: 4, signups30d: 10 });
    expect(rest).toHaveLength(0);
    expect(only?.kind).toBe("plan_next_cycle");
    expect(only?.options.find((o) => o.recommended)?.id).toBe("distribution");
  });
});
