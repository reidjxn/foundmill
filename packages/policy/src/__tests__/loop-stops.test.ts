/**
 * "When the team stops" (item 10, Nov 13, 2026; @foundmill/shared `loopStops`): every "asks you first" line that comes
 * from a tool call is held to the Cedar policies the gateway runs, through the same principal (`agentPrincipal`), for
 * each answer and spend line and on vacation. A line the list shows must be an ask (or, for what always comes to the
 * founder, a deny) in Cedar; a step Cedar asks about must have its line. So the list cannot drift from what is enforced.
 */
import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { BUSINESS_MODES, loopStops, spendLineInForceMinor, type BusinessMode, type LoopStopId, type PolicyOutcome } from "@foundmill/shared";
import { agentPrincipal, evaluate, type PrincipalAgent, type ToolCtxInput } from "../index";

const AGENT_LIMIT = LIMITS.approvalThresholdMinorDefault;
const LINES = [null, 0, 5_000, AGENT_LIMIT, 100_000] as const;
const AGENT: PrincipalAgent = { id: "agent-1", departmentIds: ["dept-1"], agentType: "channel_lead", modelKey: "sonnet", autonomy: { mode: "inherit", approvalThresholdMinor: AGENT_LIMIT } };

const TOOLS = {
  spend: { connector: "meta_ads", name: "set_daily_budget", spendsMoney: true },
  outside: { connector: "linkedin", name: "comment_on_post", contactsThirdParty: true },
  permanent: { connector: "github", name: "delete_branch", irreversible: true },
  contract: { connector: "docusign", name: "create_envelope_draft", contract: true },
  release: { connector: "github", name: "merge_pr", irreversible: true },
  pay: { connector: "mercury", name: "send_payment", spendsMoney: true, hardGate: true, irreversible: true },
  security: { connector: "cloudflare", name: "create_dns_record", securitySettings: true },
  offline: { connector: "print", name: "submit_order", requiresKitMode: true },
} satisfies Record<string, ToolCtxInput>;

function run(mode: BusinessMode, line: number | null, tool: ToolCtxInput, amountMinor = 0, holiday = false): PolicyOutcome {
  const principal = agentPrincipal(AGENT, { businessMode: mode, businessSpendCapMinor: line, holidayActive: holiday, holidayBudgetMinor: null });
  return evaluate({ principal, tool, business: { id: "biz-1", businessMode: mode, holidayActive: holiday }, context: { amountMinor } }).outcome;
}

describe("when the team stops: each line matches Cedar", () => {
  for (const mode of BUSINESS_MODES) {
    for (const holiday of [false, true]) {
      for (const line of LINES) {
        it(`${mode}${holiday ? " on vacation" : ""}, line ${line === null ? "each agent's own" : line}`, () => {
          const listed = new Set<LoopStopId>(loopStops({ mode, lineMinor: line, currency: "USD", agentLimitMinor: AGENT_LIMIT, holiday }).asks.map((s) => s.id));
          const inForce = spendLineInForceMinor(line, AGENT_LIMIT);
          // What always comes to the founder never runs; the list always says so.
          expect(listed.has("always_yours")).toBe(true);
          expect(run(mode, line, TOOLS.pay, 100, holiday)).toBe("deny");
          expect(run(mode, line, TOOLS.security, 0, holiday)).toBe("deny");
          // A purchase over the line asks in every answer; the list always has the line.
          expect(listed.has("spend")).toBe(true);
          expect(run(mode, line, TOOLS.spend, inForce + 1, holiday)).toBe("ask");
          // The other steps: listed exactly when Cedar asks.
          expect(listed.has("outside")).toBe(run(mode, line, TOOLS.outside, 0, holiday) === "ask");
          expect(listed.has("permanent")).toBe(run(mode, line, TOOLS.permanent, 0, holiday) === "ask");
          expect(listed.has("contract")).toBe(run(mode, line, TOOLS.contract, 0, holiday) === "ask");
          expect(listed.has("release")).toBe(run(mode, line, TOOLS.release, 0, holiday) === "ask");
          // A channel run in offline tracking never runs from an ordinary session: the founder submits it.
          expect(listed.has("offline_channel")).toBe(true);
          expect(run(mode, line, TOOLS.offline, 0, holiday)).toBe("deny");
        });
      }
    }
  }

  it("says 'any purchase' exactly when a purchase of one cent asks", () => {
    for (const mode of BUSINESS_MODES) {
      for (const line of LINES) {
        const spend = loopStops({ mode, lineMinor: line, currency: "USD", agentLimitMinor: AGENT_LIMIT }).asks.find((s) => s.id === "spend")!;
        expect(spend.when.startsWith("Any purchase")).toBe(run(mode, line, TOOLS.spend, 1) === "ask");
      }
    }
  });
});
