import { describe, expect, it } from "vitest";
import { effectiveApprovalThresholdMinor, LIMITS } from "../limits";

describe("effectiveApprovalThresholdMinor (the founder's Spend cap per action)", () => {
  it("lowers an agent's ask line to the business cap, never raises it", () => {
    expect(effectiveApprovalThresholdMinor(25_000, 5_000)).toBe(5_000);
    expect(effectiveApprovalThresholdMinor(2_000, 5_000)).toBe(2_000);
    expect(effectiveApprovalThresholdMinor(0, 5_000)).toBe(0);
    // An agent without its own line asks above the policy default, or the cap when that is lower.
    expect(effectiveApprovalThresholdMinor(undefined, 5_000)).toBe(5_000);
    expect(effectiveApprovalThresholdMinor(null, LIMITS.approvalThresholdMinorDefault + 1)).toBe(LIMITS.approvalThresholdMinorDefault);
  });

  it("leaves the agent's own line, or the policy default, when the business has no cap", () => {
    expect(effectiveApprovalThresholdMinor(25_000, null)).toBe(25_000);
    expect(effectiveApprovalThresholdMinor(undefined, null)).toBeUndefined();
    expect(effectiveApprovalThresholdMinor(null, undefined)).toBeUndefined();
  });
});
