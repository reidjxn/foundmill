/**
 * Settings › What the team can do (founder, 2026-11-07): each answer's words promise what the team does alone and what
 * it asks first (`TEAM_CAN_DO_OPTIONS[].promises` in @foundmill/shared). This holds those promises to the Cedar policies
 * the gateway and the plan evaluators run, through the same principal they build (`agentPrincipal`), so the page's
 * words cannot drift from what is enforced. For each answer of question 1 and each spend line of question 2: a spend
 * at the line in force and one minor unit over it, one over the business's line, an outside contact, a permanent step,
 * a contract draft, putting changes live and a hard gate.
 */
import { describe, expect, it } from "vitest";
import { LIMITS } from "@foundmill/config";
import { TEAM_CAN_DO_OPTIONS, spendLineInForceMinor, type TeamCanDoOutcome } from "@foundmill/shared";
import type { BusinessMode, PolicyOutcome } from "@foundmill/shared";
import { agentPrincipal, evaluate, type PrincipalAgent, type ToolCtxInput } from "../index";

const AGENT_LIMIT = LIMITS.approvalThresholdMinorDefault;
const LINES = [null, 0, 5_000, AGENT_LIMIT, 100_000] as const;

/** An agent as its template hires it: following the business, with the platform's default limit (packages/agents `_shared.ts`). */
const AGENT: PrincipalAgent = { id: "agent-1", departmentIds: ["dept-1"], agentType: "channel_lead", modelKey: "sonnet", autonomy: { mode: "inherit", approvalThresholdMinor: AGENT_LIMIT } };

const TOOLS = {
  spend: { connector: "meta_ads", name: "set_daily_budget", spendsMoney: true },
  outside: { connector: "linkedin", name: "comment_on_post", contactsThirdParty: true },
  permanent: { connector: "github", name: "delete_branch", irreversible: true },
  email: { connector: "sendgrid", name: "send_email", contactsThirdParty: true, irreversible: true },
  contract: { connector: "docusign", name: "create_envelope_draft", contract: true },
  release: { connector: "github", name: "merge_pr", irreversible: true },
  pay: { connector: "mercury", name: "send_payment", spendsMoney: true, hardGate: true, irreversible: true },
  sign: { connector: "docusign", name: "sign_envelope", hardGate: true, irreversible: true, contract: true },
} satisfies Record<string, ToolCtxInput>;

function run(mode: BusinessMode, line: number | null, tool: ToolCtxInput, amountMinor = 0, opts: { holiday?: boolean; agent?: PrincipalAgent } = {}): PolicyOutcome {
  const holidayActive = opts.holiday === true;
  const principal = agentPrincipal(opts.agent ?? AGENT, { businessMode: mode, businessSpendCapMinor: line, holidayActive, holidayBudgetMinor: null });
  return evaluate({ principal, tool, business: { id: "biz-1", businessMode: mode, holidayActive }, context: { amountMinor } }).outcome;
}

const as = (o: TeamCanDoOutcome): PolicyOutcome => o;

describe("what the team can do: each answer's promises match Cedar", () => {
  for (const option of TEAM_CAN_DO_OPTIONS) {
    for (const line of LINES) {
      describe(`${option.mode}, line ${line === null ? "each agent's own" : line}`, () => {
        const inForce = spendLineInForceMinor(line, AGENT_LIMIT);
        const p = option.promises;

        it("spending at the line in force does what the answer says; one unit over asks", () => {
          if (inForce > 0) expect(run(option.mode, line, TOOLS.spend, inForce)).toBe(as(p.spendWithinLine));
          expect(run(option.mode, line, TOOLS.spend, inForce + 1)).toBe("ask");
        });

        it("spending over the business's line asks in every answer", () => {
          if (line !== null) expect(run(option.mode, line, TOOLS.spend, line + 1)).toBe(as(p.spendOverLine));
        });

        it("an outside contact, a permanent step and a contract do what the answer says", () => {
          expect(run(option.mode, line, TOOLS.outside)).toBe(as(p.outside));
          expect(run(option.mode, line, TOOLS.permanent)).toBe(as(p.permanent));
          // Sending an email cannot be undone: it counts as a permanent step (the Assisted words say so).
          expect(run(option.mode, line, TOOLS.email)).toBe(p.permanent === "ask" || p.outside === "ask" ? "ask" : "allow");
          if (p.contract !== null) expect(run(option.mode, line, TOOLS.contract)).toBe(as(p.contract));
        });

        it("putting changes live always asks, and what always comes to the founder never runs", () => {
          expect(run(option.mode, line, TOOLS.release)).toBe("ask");
          expect(run(option.mode, line, TOOLS.pay, 100)).toBe("deny");
          expect(run(option.mode, line, TOOLS.sign)).toBe("deny");
        });
      });
    }
  }

  it("on vacation every answer works as the third one does, and the line still holds", () => {
    const automated = TEAM_CAN_DO_OPTIONS.find((o) => o.mode === "automated")!.promises;
    for (const option of TEAM_CAN_DO_OPTIONS) {
      expect(run(option.mode, 5_000, TOOLS.permanent, 0, { holiday: true })).toBe(as(automated.permanent));
      expect(run(option.mode, 5_000, TOOLS.spend, 5_000, { holiday: true })).toBe(as(automated.spendWithinLine));
      expect(run(option.mode, 5_000, TOOLS.spend, 5_001, { holiday: true })).toBe("ask");
      expect(run(option.mode, 5_000, TOOLS.release, 0, { holiday: true })).toBe("ask");
    }
  });

  it("an agent whose own limit is lower asks sooner than the business's line (the page's note)", () => {
    const careful = { ...AGENT, autonomy: { mode: "inherit", approvalThresholdMinor: 1_000 } };
    expect(run("assisted", 5_000, TOOLS.spend, 1_001, { agent: careful })).toBe("ask");
    // And a business line above the default does not raise an agent at the default: £1,000 still asks above £250.
    expect(run("automated", 100_000, TOOLS.spend, AGENT_LIMIT + 1)).toBe("ask");
  });
});
