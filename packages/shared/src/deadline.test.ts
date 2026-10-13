import { describe, expect, it } from "vitest";
import { DECISION_DEADLINE_MAX_DAYS, futureDeadline } from "./deadline";

const now = new Date("2026-10-12T09:00:00.000Z");
const days = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();

describe("futureDeadline (audit CML-13)", () => {
  it("keeps an ISO timestamp in the future within the horizon, normalized", () => {
    expect(futureDeadline("2026-10-20T00:00:00Z", now)).toBe("2026-10-20T00:00:00.000Z");
    expect(futureDeadline("2026-10-20", now)).toBe("2026-10-20T00:00:00.000Z");
    expect(futureDeadline(days(30), now)).toBe(days(30));
  });

  it("drops a deadline that has passed, however the model came by it", () => {
    expect(futureDeadline("2020-01-01T00:00:00Z", now)).toBeNull();
    expect(futureDeadline("2026-10-12T09:00:00Z", now)).toBeNull();
    expect(futureDeadline("2026-10-11", now)).toBeNull();
  });

  it("drops anything that is not an ISO date, and one beyond the horizon", () => {
    for (const bad of ["next Tuesday", "5/6/26", "Oct 20", "", "soon", "2026-13-45T00:00:00Z", null, undefined, 1_800_000_000_000, {}]) expect(futureDeadline(bad, now), String(bad)).toBeNull();
    expect(futureDeadline(days(DECISION_DEADLINE_MAX_DAYS + 1), now)).toBeNull();
    expect(futureDeadline(days(DECISION_DEADLINE_MAX_DAYS), now)).not.toBeNull();
    expect(futureDeadline(days(400), now, 400)).not.toBeNull();
  });
});
