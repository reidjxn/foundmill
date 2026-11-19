import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GO_TO_MARKET_EVALS, GO_TO_MARKET_EVAL_FILES } from "../go-to-market";

const WORKFLOW = join(__dirname, "../../../.github/workflows/evals-go-to-market.yml");

describe("go-to-market evals", () => {
  it("lists live suites that exist", () => {
    for (const e of GO_TO_MARKET_EVALS) expect(existsSync(join(__dirname, e.file)), e.file).toBe(true);
  });
  it("is the list the nightly workflow runs, on a schedule, with a live model", () => {
    const yml = readFileSync(WORKFLOW, "utf8");
    expect(yml).toMatch(/cron: "0 3 \* \* \*"/);
    expect(yml).toMatch(/MODEL_MODE: live/);
    for (const f of GO_TO_MARKET_EVAL_FILES) expect(yml, f).toContain(`src/__tests__/${f}`);
  });
});
