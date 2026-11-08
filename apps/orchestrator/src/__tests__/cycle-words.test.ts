/**
 * The Inbox words the cycle writes (founder, Nov 8, 2026: Builder view): stored once and read by everyone, so always in
 * founder words, with no cycle number and no engine words the Composer's check would catch.
 */
import { founderJargonHits } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { CYCLE_NOT_FINISHED_SUBJECT, CYCLE_NOT_STARTED_SUBJECT, cycleOutcomeSubject, cycleTallyLine } from "../cycle-contract";

describe("cycle words", () => {
  it("every subject is a founder sentence that fits an Inbox subject", () => {
    expect(CYCLE_NOT_FINISHED_SUBJECT).toBe("The team's last round of work did not finish");
    expect(CYCLE_NOT_STARTED_SUBJECT).toBe("The team could not start work");
    expect(cycleOutcomeSubject("completed")).toBe("The team finished a round of work");
    expect(cycleOutcomeSubject("time_box")).toBe("The team's round of work reached its time limit");
    expect(cycleOutcomeSubject("waiting")).toBe("The team is waiting on you");
    expect(cycleOutcomeSubject("failed")).toBe(CYCLE_NOT_FINISHED_SUBJECT);
    for (const s of [CYCLE_NOT_FINISHED_SUBJECT, CYCLE_NOT_STARTED_SUBJECT, ...["completed", "time_box", "waiting", "stopped", "failed", "other"].map(cycleOutcomeSubject)]) {
      expect(s.length, s).toBeLessThanOrEqual(80);
      expect(founderJargonHits(s), s).toEqual([]);
      expect(s).not.toMatch(/cycle|_/i);
    }
  });

  it("the tally counts tasks, not sessions, and names no cycle", () => {
    expect(cycleTallyLine({ started: 1, finished: 1, blocked: 0, stillRunning: 0, deferred: 0 })).toBe("This round of work: 1 task started, 1 finished, 0 blocked.");
    const busy = cycleTallyLine({ started: 3, finished: 1, blocked: 1, stillRunning: 1, deferred: 2 });
    expect(busy).toBe("This round of work: 3 tasks started, 1 finished, 1 blocked, 1 still running past the time limit; 2 tasks deferred.");
    expect(founderJargonHits(busy)).toEqual([]);
  });
});
