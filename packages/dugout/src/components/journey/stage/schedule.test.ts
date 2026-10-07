import { describe, expect, it } from "vitest";
import { createRng } from "../../../lib/seed";
import { matchDayFixture } from "../fixtures";
import { buildReplaySchedule, commentaryShownBy, formatReplayClock, matchPositions, selectReplayTouches, stageAt, STAGE_ORDER, touchesPlayedBy } from "./schedule";

const { journey, touches } = matchDayFixture();

describe("buildReplaySchedule (AC-11.4.3)", () => {
  it("is deterministic: the same record produces the same frames and hash, whatever the input order", () => {
    const a = buildReplaySchedule(journey, touches, "full");
    const b = buildReplaySchedule(journey, touches, "full");
    expect(b).toEqual(a);
    const shuffled = createRng("shuffle").shuffle(touches);
    const c = buildReplaySchedule({ ...journey, touchIds: createRng("ids").shuffle(journey.touchIds) }, shuffled, "full");
    expect(c.frames).toEqual(a.frames);
    expect(c.hash).toBe(a.hash);
    expect(buildReplaySchedule(journey, touches, "highlights").hash).not.toBe(a.hash);
  });

  it("keeps the stage order and the speed budgets", () => {
    const full = buildReplaySchedule(journey, touches, "full");
    expect(full.stages.map((s) => s.stage)).toEqual([...STAGE_ORDER]);
    expect(full.durationMs).toBeGreaterThanOrEqual(45_000);
    expect(full.durationMs).toBeLessThanOrEqual(60_000);
    for (let i = 1; i < full.stages.length; i++) expect(full.stages[i]!.startMs).toBe(full.stages[i - 1]!.endMs);
    const hl = buildReplaySchedule(journey, touches, "highlights");
    expect(hl.durationMs).toBeGreaterThanOrEqual(10_000);
    expect(hl.durationMs).toBeLessThanOrEqual(15_000);
    const instant = buildReplaySchedule(journey, touches, "instant");
    expect(instant.durationMs).toBe(0);
    expect(instant.frames.every((f) => f.at === 0)).toBe(true);
    expect(stageAt(instant, 0)).toBe("full_time");
  });

  it("places every touch inside the match window, in time order, with commentary just after its touch", () => {
    const s = buildReplaySchedule(journey, touches, "full");
    const match = s.stages.find((w) => w.stage === "match")!;
    const touchFrames = s.frames.filter((f) => f.kind === "touch");
    expect(touchFrames.length).toBe(touches.length);
    for (const f of touchFrames) {
      expect(f.at).toBeGreaterThanOrEqual(match.startMs);
      expect(f.at).toBeLessThan(match.endMs);
    }
    for (let i = 1; i < touchFrames.length; i++) expect(touchFrames[i]!.at).toBeGreaterThan(touchFrames[i - 1]!.at);
    for (let i = 1; i < s.frames.length; i++) expect(s.frames[i]!.at).toBeGreaterThanOrEqual(s.frames[i - 1]!.at);
    const commentaryFrames = s.frames.filter((f) => f.kind === "commentary");
    expect(commentaryFrames.length).toBe(journey.commentary.length);
    for (const c of commentaryFrames) {
      if (!c.touchId) continue;
      const t = touchFrames.find((f) => f.touchId === c.touchId)!;
      expect(c.at - t.at).toBeGreaterThan(0);
      expect(c.at - t.at).toBeLessThanOrEqual(320);
    }
    expect(touchesPlayedBy(s, match.startMs - 1)).toEqual([]);
    expect(touchesPlayedBy(s, s.durationMs)).toEqual(s.touchIds);
    expect(commentaryShownBy(s, s.durationMs).length).toBe(journey.commentary.length);
  });

  it("Highlights keeps the captain, the first and last touch and the heaviest ones", () => {
    const shown = selectReplayTouches(journey, touches, "highlights");
    expect(shown.length).toBeLessThanOrEqual(6);
    const ids = shown.map((t) => t.id);
    expect(ids).toContain(journey.captain!.touchId);
    expect(ids[0]).toBe(touches[0]!.id);
    expect(ids[ids.length - 1]).toBe(touches[touches.length - 1]!.id);
    const hl = buildReplaySchedule(journey, touches, "highlights");
    expect(hl.commentary.every((c) => c.highlight || (c.touchId && ids.includes(c.touchId)))).toBe(true);
  });

  it("compresses long gaps and keeps a minimum spacing", () => {
    const hour = 3_600_000;
    const pos = matchPositions([0, hour, 24 * 7 * hour, 24 * 7 * hour + hour], 30_000);
    expect(pos[0]).toBeGreaterThan(0);
    const weekGap = pos[2]! - pos[1]!;
    const hourGap = pos[1]! - pos[0]!;
    expect(weekGap).toBeGreaterThan(hourGap);
    expect(weekGap).toBeLessThan(hourGap * 6);
    expect(pos[3]).toBeLessThan(30_000);
    expect(matchPositions([0, 1], 0)).toEqual([0, 0]);
    expect(formatReplayClock(65_400)).toBe("01:05");
  });

  it("reports the stage for any clock time", () => {
    const s = buildReplaySchedule(journey, touches, "full");
    expect(stageAt(s, 0)).toBe("team_sheet");
    expect(stageAt(s, 6000)).toBe("kick_off");
    expect(stageAt(s, 10_000)).toBe("match");
    expect(stageAt(s, 42_000)).toBe("rails");
    expect(stageAt(s, 50_000)).toBe("goal");
    expect(stageAt(s, 54_000)).toBe("full_time");
    expect(stageAt(s, 1e9)).toBe("full_time");
  });
});
