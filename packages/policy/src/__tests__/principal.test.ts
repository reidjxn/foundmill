/**
 * Who a policy check runs as (audit api-services-03): the one definition the gateway and plan evaluation share, so a plan
 * action is judged as the acting agent's own tool call would be.
 */
import { LIMITS } from "@foundmill/config";
import { describe, expect, it } from "vitest";
import { agentAutonomy, agentPrincipal, businessApprovalThreshold } from "../principal";

const agent = (autonomy: Record<string, unknown> = {}) => ({ id: "a1", departmentIds: ["d1"], agentType: "channel_paid_ads", modelKey: "sonnet" as const, autonomy });
const scope = { businessMode: "assisted" as const, businessSpendCapMinor: null, holidayActive: false, holidayBudgetMinor: null };

describe("agentAutonomy", () => {
  it("reads inherit, a business mode, and lower / higher relative to the business's", () => {
    expect(agentAutonomy({ autonomy: {} }, "assisted").autonomy).toBe("inherit");
    expect(agentAutonomy({ autonomy: { mode: "automated" } }, "assisted").autonomy).toBe("automated");
    expect(agentAutonomy({ autonomy: { mode: "lower" } }, "assisted").autonomy).toBe("augmented");
    expect(agentAutonomy({ autonomy: { mode: "higher" } }, "assisted").autonomy).toBe("automated");
    // Nowhere further to go: it inherits.
    expect(agentAutonomy({ autonomy: { mode: "lower" } }, "augmented").autonomy).toBe("inherit");
  });

  it("keeps only whole, non-negative amounts", () => {
    expect(agentAutonomy({ autonomy: { spendCapMinor: 0, approvalThresholdMinor: 300 } }, "assisted")).toMatchObject({ spendCapMinor: 0, approvalThresholdMinor: 300 });
    expect(agentAutonomy({ autonomy: { spendCapMinor: -1, approvalThresholdMinor: 1.5 } }, "assisted")).toMatchObject({ spendCapMinor: undefined, approvalThresholdMinor: undefined });
  });
});

describe("agentPrincipal", () => {
  it("carries the agent's own autonomy, cap and threshold", () => {
    expect(agentPrincipal(agent({ mode: "lower", spendCapMinor: 0, approvalThresholdMinor: 0 }), scope)).toMatchObject({ id: "a1", department: "d1", type: "channel_paid_ads", autonomy: "augmented", spendCapMinor: 0, approvalThresholdMinor: 0 });
  });

  it("an agent with nothing set leaves the policy defaults alone", () => {
    const p = agentPrincipal(agent(), scope);
    expect(p).toMatchObject({ autonomy: "inherit" });
    expect(p).not.toHaveProperty("spendCapMinor");
    expect(p).not.toHaveProperty("approvalThresholdMinor");
  });

  it("the founder's spend cap per action lowers the threshold, and never raises it", () => {
    expect(agentPrincipal(agent(), { ...scope, businessSpendCapMinor: 5_000 }).approvalThresholdMinor).toBe(5_000);
    expect(agentPrincipal(agent({ approvalThresholdMinor: 300 }), { ...scope, businessSpendCapMinor: 5_000 }).approvalThresholdMinor).toBe(300);
    expect(businessApprovalThreshold(undefined, 90_000_000)).toBe(LIMITS.approvalThresholdMinorDefault);
  });

  it("the vacation budget ceiling caps spend only while the vacation lasts, under the agent's own cap", () => {
    const vacation = { ...scope, holidayActive: true, holidayBudgetMinor: 1_000 };
    expect(agentPrincipal(agent(), vacation).spendCapMinor).toBe(1_000);
    expect(agentPrincipal(agent({ spendCapMinor: 400 }), vacation).spendCapMinor).toBe(400);
    expect(agentPrincipal(agent({ spendCapMinor: 4_000 }), vacation).spendCapMinor).toBe(1_000);
    expect(agentPrincipal(agent(), { ...vacation, holidayActive: false })).not.toHaveProperty("spendCapMinor");
  });

  it("names a department for an agent that has none", () => {
    expect(agentPrincipal({ ...agent(), departmentIds: [] }, scope).department).toBe("unassigned");
    expect(agentPrincipal({ ...agent(), departmentIds: [] }, scope, { department: "team" }).department).toBe("team");
  });
});
