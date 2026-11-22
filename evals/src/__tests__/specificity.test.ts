import type { PositioningNotes } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { specificityProblems } from "../specificity";

const line = (text: string, label: "founder" | "assumption" = "founder") => ({ text, label, source: label === "founder" ? "founder, Nov 16, 2026" : null });
const NOTES = {
  version: 1,
  updatedOn: "2026-11-16",
  oneLine: "Bike repairs that come to your door",
  step: "follow",
  forWhom: [line("Commuters in Leeds whose bike broke on the way to work")],
  problem: [],
  today: [],
  different: [line("A van full of parts comes to the bike and fixes it where it stands")],
  proof: [line("Fixed 14 bikes in the first month")],
  objections: [],
  voice: { traits: [], uses: [], never: [] },
  learned: [],
  changes: [],
} as PositioningNotes;

describe("specificityProblems", () => {
  it("passes an output that names the person and a difference and keeps to the proof", () => {
    expect(specificityProblems("Commuters in Leeds: a van comes to the bike and fixes it where it stands. We fixed 14 bikes in the first month.", NOTES)).toEqual([]);
  });
  it("fails a generic output that names nobody and no difference", () => {
    expect(specificityProblems("We are excited to launch something great for everyone.", NOTES)).toEqual(["does not name the person the project is for", "names no difference from the project's notes"]);
  });
  it("fails a figure or a quotation the proof does not hold", () => {
    const p = specificityProblems("Commuters in Leeds get a van that fixes the bike where it stands. We fixed 400 bikes and one said \"best repair ever\".", NOTES);
    expect(p).toEqual(["a figure the proof does not give: 400", "a quotation the proof does not hold: \"best repair ever\""]);
  });
});
