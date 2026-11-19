import { describe, expect, it } from "vitest";
import { meter } from "./pricing";
import { MODELS, resolveModel } from "./routing";
import { REFERENCE_GRADE_USAGE, REFERENCE_TEST_USAGE, trainingEstimate } from "./training-estimate";

describe("trainingEstimate (WP-09 T9)", () => {
  it("prices each test as the candidate on the agent's model plus a grade on the grader's routed model, rounded up", () => {
    const perTest = meter(REFERENCE_TEST_USAGE, MODELS.sonnet).costMicroMinor + meter(REFERENCE_GRADE_USAGE, resolveModel("skillGrader").modelId).costMicroMinor;
    expect(trainingEstimate({ tests: 10, agentModel: "sonnet", batch: false })).toEqual({ costMinor: Math.ceil((perTest * 10) / 1_000_000), currency: "USD", label: "Estimate" });
    expect(trainingEstimate({ tests: 0, agentModel: "opus", batch: false }).costMinor).toBe(0);
  });
  it("prices a batch at about half", () => {
    const now = trainingEstimate({ tests: 40, agentModel: "opus", batch: false }).costMinor;
    const batch = trainingEstimate({ tests: 40, agentModel: "opus", batch: true }).costMinor;
    expect(Math.abs(batch - now / 2)).toBeLessThanOrEqual(1);
  });
});
