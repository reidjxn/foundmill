import { describe, expect, it } from "vitest";
import { BUSINESS_MODES, type BusinessMode, type PolicyOutcome } from "@foundmill/shared";
import { LIMITS } from "@foundmill/config";
import {
  evaluate, createPolicyEngine, parsePolicyText, toEntities, toContext, effectiveBusinessMode, EvaluateInput, NO_SPEND_CAP_MINOR,
  type EvaluateInputInput, type ToolCtxInput, type CallContextInput, type AgentCtxInput,
} from "../index";

const THRESHOLD = 25_000; // €250.00
const CAP = 100_000; // €1,000.00

const agent = (over: Partial<AgentCtxInput> = {}): AgentCtxInput => ({
  id: "agent-1", department: "dept-1", type: "channel_lead", modelKey: "sonnet",
  approvalThresholdMinor: THRESHOLD, spendCapMinor: CAP, ...over,
});
const tool = (over: Partial<ToolCtxInput> = {}): ToolCtxInput => ({ connector: "sendgrid", name: "send_email", ...over });
const business = (mode: BusinessMode, holidayActive = false) => ({ id: "biz-1", businessMode: mode, holidayActive });

function run(mode: BusinessMode, t: Partial<ToolCtxInput> = {}, ctx: CallContextInput = {}, a: Partial<AgentCtxInput> = {}) {
  return evaluate({ principal: agent(a), tool: tool(t), business: business(mode), context: ctx });
}

/** Tools as the gateway would describe them from connector policyHints. */
const TOOLS = {
  internalDraft: { connector: "notion", name: "write_page" },
  codeOnBranch: { connector: "github", name: "push_branch" },
  releaseFile: { connector: "cli_inkscape", name: "release_output", contactsThirdParty: true },
  mergeToMain: { connector: "github", name: "merge_pr", irreversible: true },
  /** An irreversible step that is not a release: the mode rules alone decide it. */
  deleteBranch: { connector: "github", name: "delete_branch", irreversible: true },
  sendEmail: { connector: "sendgrid", name: "send_email", contactsThirdParty: true },
  adSpend: { connector: "meta_ads", name: "set_daily_budget", spendsMoney: true },
  payInvoice: { connector: "mercury", name: "send_payment", spendsMoney: true, hardGate: true, irreversible: true },
  signContract: { connector: "docusign", name: "sign_envelope", hardGate: true, irreversible: true, contract: true },
  draftContract: { connector: "docusign", name: "create_envelope_draft", contract: true },
  deleteForever: { connector: "google_drive", name: "delete_permanently", hardGate: true, irreversible: true },
  financeReconcile: { connector: "codat", name: "reconcile_transactions", finance: true },
  financePayout: { connector: "stripe", name: "create_payout", finance: true, spendsMoney: true },
  printAd: { connector: "stannp", name: "submit_print_order", requiresKitMode: true, spendsMoney: true, contactsThirdParty: true },
} satisfies Record<string, ToolCtxInput>;

type Row = { name: string; tool: ToolCtxInput; ctx?: CallContextInput; expect: Record<BusinessMode, PolicyOutcome>; policy?: string };

/** Every rule × every business mode. */
const TABLE: Row[] = [
  { name: "internal draft", tool: TOOLS.internalDraft, expect: { augmented: "allow", assisted: "allow", automated: "allow" } },
  { name: "code on a branch", tool: TOOLS.codeOnBranch, expect: { augmented: "allow", assisted: "allow", automated: "allow" } },
  // Going live is the founder's one tap in every mode (decision 2026-11-01).
  { name: "releasing a made file", tool: TOOLS.releaseFile, expect: { augmented: "ask", assisted: "ask", automated: "ask" }, policy: "cli-release-asks-founder" },
  { name: "merge to the default branch", tool: TOOLS.mergeToMain, expect: { augmented: "ask", assisted: "ask", automated: "ask" }, policy: "release-asks-founder" },
  { name: "send email (external)", tool: TOOLS.sendEmail, expect: { augmented: "ask", assisted: "allow", automated: "allow" } },
  { name: "ad spend within threshold", tool: TOOLS.adSpend, ctx: { amountMinor: 10_000 }, expect: { augmented: "ask", assisted: "allow", automated: "allow" } },
  { name: "ad spend at threshold (boundary)", tool: TOOLS.adSpend, ctx: { amountMinor: THRESHOLD }, expect: { augmented: "ask", assisted: "allow", automated: "allow" } },
  { name: "ad spend one minor unit above threshold", tool: TOOLS.adSpend, ctx: { amountMinor: THRESHOLD + 1 }, expect: { augmented: "ask", assisted: "ask", automated: "ask" } },
  { name: "ad spend above spend cap", tool: TOOLS.adSpend, ctx: { amountMinor: CAP + 1 }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "spend-cap-exceeded" },
  { name: "ad spend at spend cap", tool: TOOLS.adSpend, ctx: { amountMinor: CAP }, expect: { augmented: "ask", assisted: "ask", automated: "ask" } },
  { name: "draft contract", tool: TOOLS.draftContract, expect: { augmented: "allow", assisted: "ask", automated: "allow" } },
  { name: "pay invoice (hard gate)", tool: TOOLS.payInvoice, ctx: { amountMinor: 100 }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "hard-gate" },
  { name: "sign contract (hard gate)", tool: TOOLS.signContract, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "hard-gate" },
  { name: "permanent deletion (hard gate)", tool: TOOLS.deleteForever, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "hard-gate" },
  { name: "suppressed recipient", tool: TOOLS.sendEmail, ctx: { suppressed: true, recipient: "a@example.com" }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "suppressed-recipient" },
  { name: "recipient first seen in untrusted content", tool: TOOLS.sendEmail, ctx: { recipientFirstSeenInUntrusted: true, recipient: "b@example.com" }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "untrusted-recipient" },
  // No email without a basis (WP-08 T10): the gateway sets `recipientBasis` for the mail-sending tools only.
  { name: "email to an address with no basis", tool: TOOLS.sendEmail, ctx: { recipientBasis: "none", recipient: "c@example.com" }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "mail-needs-basis" },
  { name: "email to a person the founder added", tool: TOOLS.sendEmail, ctx: { recipientBasis: "recorded", recipient: "d@example.com" }, expect: { augmented: "ask", assisted: "ask", automated: "ask" }, policy: "mail-recorded-basis-asks" },
  { name: "email to a person who agreed", tool: TOOLS.sendEmail, ctx: { recipientBasis: "consent" }, expect: { augmented: "ask", assisted: "allow", automated: "allow" } },
  { name: "email to a person who wrote or paid", tool: TOOLS.sendEmail, ctx: { recipientBasis: "relationship" }, expect: { augmented: "ask", assisted: "allow", automated: "allow" } },
  { name: "no basis, but the tool contacts nobody", tool: TOOLS.internalDraft, ctx: { recipientBasis: "none" }, expect: { augmented: "allow", assisted: "allow", automated: "allow" } },
  { name: "suppressed but tool does not contact anyone", tool: TOOLS.internalDraft, ctx: { suppressed: true, recipientFirstSeenInUntrusted: true }, expect: { augmented: "allow", assisted: "allow", automated: "allow" } },
  { name: "finance read-only tool", tool: TOOLS.financeReconcile, expect: { augmented: "allow", assisted: "allow", automated: "allow" } },
  { name: "finance tool that would pay out (AC-11.8.5)", tool: TOOLS.financePayout, ctx: { amountMinor: 1 }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "finance-never-spends" },
  { name: "kit-mode channel from a non-kit session", tool: TOOLS.printAd, ctx: { amountMinor: 1_000, kitMode: false }, expect: { augmented: "deny", assisted: "deny", automated: "deny" }, policy: "kit-mode-channel" },
  { name: "kit-mode channel from a kit session", tool: TOOLS.printAd, ctx: { amountMinor: 1_000, kitMode: true }, expect: { augmented: "ask", assisted: "allow", automated: "allow" } },
];

describe("evaluate: every rule × every business mode", () => {
  for (const row of TABLE) {
    for (const mode of BUSINESS_MODES) {
      it(`${row.name} → ${mode}: ${row.expect[mode]}`, () => {
        const result = run(mode, row.tool, row.ctx ?? {});
        expect(result.outcome).toBe(row.expect[mode]);
        expect(result.policyIds.length).toBeGreaterThan(0);
        expect(result.reasons.length).toBe(result.policyIds.length);
        if (row.policy) expect(result.policyIds).toContain(row.policy);
      });
    }
  }
});

describe("hard gates can never be lifted", () => {
  const gated = [TOOLS.payInvoice, TOOLS.signContract, TOOLS.deleteForever];
  const liftAttempts: { name: string; ctx?: CallContextInput; agent?: Partial<AgentCtxInput>; holiday?: boolean }[] = [
    { name: "zero amount", ctx: { amountMinor: 0 } },
    { name: "kit mode on", ctx: { kitMode: true } },
    { name: "holiday active", ctx: { holidayActive: true }, holiday: true },
    { name: "no spend cap, huge threshold", agent: { spendCapMinor: undefined, approvalThresholdMinor: Number.MAX_SAFE_INTEGER } },
    { name: "agent autonomy override to automated", agent: { autonomy: "automated" } },
    { name: "chief of staff on opus", agent: { type: "chief_of_staff", modelKey: "opus" } },
  ];
  for (const t of gated) for (const mode of BUSINESS_MODES) for (const attempt of liftAttempts) {
    it(`${t.connector}:${t.name} in ${mode} with ${attempt.name} → deny by hard-gate`, () => {
      const result = evaluate({
        principal: agent(attempt.agent), tool: t, business: business(mode, attempt.holiday ?? false), context: attempt.ctx ?? {},
      });
      expect(result.outcome).toBe("deny");
      expect(result.policyIds).toContain("hard-gate");
      expect(result.reasons.join(" ")).toMatch(/Hard gate/);
    });
  }

  it("a call flagged as a security-settings change is denied by hard-gate-security-settings in every mode, whatever the tool's hints", () => {
    for (const mode of ["augmented", "assisted", "automated"] as const) {
      const r = run(mode, { connector: "cloudflare_dns", name: "update_record", securitySettings: true });
      expect(r, mode).toEqual({ outcome: "deny", reasons: ["Hard gate: this changes a security setting, which always requires a human (BUILD §2.2)"], policyIds: ["hard-gate-security-settings"] });
    }
    // The same tool without the flag is an ordinary call (the flag is the gateway's, per call).
    expect(run("assisted", { connector: "cloudflare_dns", name: "update_record" }).outcome).toBe("allow");
  });

  it("a hard-gated tool that is not also irreversible or spending is still denied", () => {
    const r = run("automated", { connector: "google", name: "grant_oauth_consent", hardGate: true });
    expect(r).toEqual({ outcome: "deny", reasons: ["Hard gate: this action always requires a human (BUILD §2.2)"], policyIds: ["hard-gate"] });
  });
});

describe("deny beats ask beats allow", () => {
  it("reports only forbids when a forbid and a permit both match", () => {
    const r = run("assisted", TOOLS.sendEmail, { suppressed: true });
    expect(r.outcome).toBe("deny");
    expect(r.policyIds).toEqual(["suppressed-recipient"]);
  });
  it("lists every matching forbid", () => {
    const r = run("automated", TOOLS.financePayout, { amountMinor: CAP + 1, suppressed: true });
    expect(r.outcome).toBe("deny");
    expect(r.policyIds).toEqual(expect.arrayContaining(["finance-never-spends", "spend-cap-exceeded"]));
    expect(r.policyIds).not.toContain("suppressed-recipient"); // tool does not contact a third party
  });
  it("ask wins over allow when both a plain permit and an ask permit match", () => {
    const set = {
      ...createPolicyEngine().policySet,
    };
    const extra = parsePolicyText(
      `@id("test-allow-all") @reason("test") permit (principal is Agent, action == Action::"call", resource is Tool);`,
      "test.cedar",
    );
    const policies = [...set.policies, ...extra];
    const byId = Object.fromEntries(policies.map((p) => [p.id, p]));
    const staticPolicies = Object.fromEntries(policies.map((p) => [p.id, p.text]));
    const engine = createPolicyEngine({ policies, byId, staticPolicies });
    const r = evaluate({ principal: agent(), tool: TOOLS.sendEmail, business: business("augmented") }, engine);
    expect(r.outcome).toBe("ask");
    expect(r.policyIds).toEqual(["augmented-ask-external"]);
  });
  it("denies with an explanation when no policy permits", () => {
    const engine = createPolicyEngine(((): ReturnType<typeof createPolicyEngine>["policySet"] => {
      const only = parsePolicyText(`@id("x") @reason("x") permit (principal, action, resource) when { context.amountMinor < 0 };`, "x.cedar");
      return { policies: only, byId: { x: only[0]! }, staticPolicies: { x: only[0]!.text } };
    })());
    const r = evaluate({ principal: agent(), tool: TOOLS.internalDraft, business: business("automated") }, engine);
    expect(r).toEqual({ outcome: "deny", reasons: ["No policy permits this call"], policyIds: [] });
  });
});

describe("ask is derived from the @outcome annotation", () => {
  it("augmented external action asks via augmented-ask-external", () => {
    const r = run("augmented", TOOLS.sendEmail);
    expect(r).toEqual({ outcome: "ask", reasons: ["Augmented mode: external actions and spending need approval"], policyIds: ["augmented-ask-external"] });
  });
  it("assisted above-threshold spend asks via assisted-ask-above-threshold", () => {
    const r = run("assisted", TOOLS.adSpend, { amountMinor: THRESHOLD + 1 });
    expect(r.outcome).toBe("ask");
    expect(r.policyIds).toEqual(["assisted-ask-above-threshold"]);
  });
  it("automated above-threshold spend asks via automated-ask-above-threshold", () => {
    const r = run("automated", TOOLS.adSpend, { amountMinor: THRESHOLD + 1 });
    expect(r.policyIds).toEqual(["automated-ask-above-threshold"]);
  });
  it("assisted irreversible asks even with zero amount", () => {
    expect(run("assisted", TOOLS.deleteBranch).policyIds).toEqual(["assisted-ask-irreversible"]);
  });
  it("a merge to the default branch asks in every mode, with the founder's own words as the reason", () => {
    for (const mode of BUSINESS_MODES) {
      const r = run(mode, TOOLS.mergeToMain);
      expect(r.outcome).toBe("ask");
      expect(r.policyIds).toContain("release-asks-founder");
      expect(r.reasons).toContain("You chose to be asked before anything goes live");
    }
  });
  it("assisted contract asks", () => {
    expect(run("assisted", TOOLS.draftContract).policyIds).toEqual(["assisted-ask-contract"]);
  });
  it("augmented irreversible internal step asks", () => {
    expect(run("augmented", TOOLS.deleteBranch).policyIds).toEqual(["augmented-ask-irreversible"]);
  });
});

describe("caps", () => {
  it("default approval threshold comes from config when not given", () => {
    const parsed = EvaluateInput.parse({ principal: { id: "a", department: "d", type: "t", modelKey: "haiku" }, tool: tool(), business: business("assisted") });
    expect(parsed.principal.approvalThresholdMinor).toBe(LIMITS.approvalThresholdMinorDefault);
    expect(parsed.principal.spendCapMinor).toBeUndefined();
    expect(toEntities(parsed)[0]!.attrs["spendCapMinor"]).toBe(NO_SPEND_CAP_MINOR);
  });
  it("an agent without a spend cap is never denied for the cap, but still asks above threshold", () => {
    const r = run("automated", TOOLS.adSpend, { amountMinor: 50_000_000 }, { spendCapMinor: undefined });
    expect(r.outcome).toBe("ask");
  });
  it("a spend cap below the threshold denies before asking", () => {
    const r = run("assisted", TOOLS.adSpend, { amountMinor: 20_000 }, { spendCapMinor: 10_000, approvalThresholdMinor: THRESHOLD });
    expect(r.outcome).toBe("deny");
    expect(r.policyIds).toEqual(["spend-cap-exceeded"]);
  });
  it("the spend cap only applies to tools that spend money", () => {
    const r = run("assisted", TOOLS.sendEmail, { amountMinor: CAP + 1 });
    expect(r.outcome).toBe("ask"); // above threshold asks, but is not denied
    expect(r.policyIds).toEqual(["assisted-ask-above-threshold"]);
  });
});

describe("finance tools (AC-11.8.5)", () => {
  it("no Finance tool can initiate a payment in any mode, even within caps and with every flag favourable", () => {
    for (const mode of BUSINESS_MODES) {
      const r = evaluate({
        principal: agent({ autonomy: "automated", spendCapMinor: undefined }),
        tool: { connector: "mercury", name: "pay_vendor", finance: true, spendsMoney: true },
        business: business(mode, true),
        context: { amountMinor: 1, kitMode: true },
      });
      expect(r.outcome).toBe("deny");
      expect(r.policyIds).toContain("finance-never-spends");
    }
  });
  it("finance tools that do not spend are governed by the normal mode rules", () => {
    expect(run("augmented", TOOLS.financeReconcile).outcome).toBe("allow");
    expect(run("augmented", { ...TOOLS.financeReconcile, contactsThirdParty: true }).outcome).toBe("ask");
  });
});

describe("kit mode", () => {
  it("requiresKitMode tools are denied outside kit mode in every mode and allowed/asked inside it", () => {
    for (const mode of BUSINESS_MODES) {
      expect(run(mode, TOOLS.printAd, { kitMode: false }).policyIds).toEqual(["kit-mode-channel"]);
      expect(run(mode, TOOLS.printAd, { kitMode: true }).outcome).not.toBe("deny");
    }
  });
  it("the deny reason names offline tracking, the user-facing name of kit mode", () => {
    expect(run("assisted", TOOLS.printAd, { kitMode: false }).reasons).toEqual(["This channel uses offline tracking: the agent prepares, the founder submits"]);
  });
  it("kitMode on a tool that does not require it changes nothing", () => {
    expect(run("assisted", TOOLS.sendEmail, { kitMode: true }).outcome).toBe("allow");
  });
});

describe("per-agent autonomy override and holiday", () => {
  it("an agent's autonomy replaces the business mode for mode rules only", () => {
    const input = EvaluateInput.parse({ principal: agent({ autonomy: "augmented" }), tool: tool(), business: business("automated") });
    expect(effectiveBusinessMode(input)).toBe("augmented");
    const r = evaluate({ principal: agent({ autonomy: "augmented" }), tool: TOOLS.sendEmail, business: business("automated") });
    expect(r.policyIds).toEqual(["augmented-ask-external"]);
    const r2 = evaluate({ principal: agent({ autonomy: "automated" }), tool: TOOLS.deleteBranch, business: business("augmented") });
    expect(r2.outcome).toBe("allow");
  });
  it("holidayActive defaults from the business and is passed in the context", () => {
    const input = EvaluateInput.parse({ principal: agent(), tool: tool(), business: business("automated", true) });
    expect(toContext(input)["holidayActive"]).toBe(true);
    const r = run("automated", TOOLS.adSpend, { amountMinor: 1, holidayActive: true });
    expect(r.outcome).toBe("allow");
  });
  it("on vacation an Assisted or Augmented business runs as Automated: hard gates still queue (OL-26)", () => {
    const on = (mode: BusinessMode, t: ToolCtxInput, ctx: CallContextInput = {}, a: Partial<AgentCtxInput> = {}) => evaluate({ principal: agent(a), tool: t, business: business(mode, true), context: ctx });
    expect(effectiveBusinessMode(EvaluateInput.parse({ principal: agent(), tool: tool(), business: business("assisted", true) }))).toBe("automated");
    // What Assisted asks for, the vacation's Automated mode does within caps; a release still asks the founder.
    expect(on("assisted", TOOLS.deleteBranch).outcome).toBe("allow");
    expect(on("assisted", TOOLS.mergeToMain).outcome).toBe("ask");
    expect(on("assisted", TOOLS.draftContract).outcome).toBe("allow");
    expect(on("augmented", TOOLS.sendEmail).outcome).toBe("allow");
    // Above the threshold still asks, and hard gates never lift.
    expect(on("assisted", TOOLS.adSpend, { amountMinor: THRESHOLD + 1 }).outcome).toBe("ask");
    expect(on("assisted", TOOLS.signContract).outcome).toBe("deny");
    expect(on("assisted", TOOLS.payInvoice, { amountMinor: 100 }).outcome).toBe("deny");
    // An agent the founder gave its own autonomy keeps it.
    expect(on("assisted", TOOLS.sendEmail, {}, { autonomy: "augmented" }).policyIds).toEqual(["augmented-ask-external"]);
    // Back from vacation, the business's own mode applies again.
    expect(run("assisted", TOOLS.deleteBranch).outcome).toBe("ask");
  });
});

describe("input validation and robustness", () => {
  it("rejects malformed input with a ZodError before touching Cedar", () => {
    expect(() => evaluate({ principal: agent({ modelKey: "gpt" as never }), tool: tool(), business: business("assisted") })).toThrow();
    expect(() => evaluate({ principal: agent(), tool: tool(), business: { id: "b", businessMode: "yolo" as never } })).toThrow();
    expect(() => evaluate({ principal: agent(), tool: tool(), business: business("assisted"), context: { amountMinor: -1 } })).toThrow();
    expect(() => evaluate({ principal: agent(), tool: tool(), business: business("assisted"), context: { amountMinor: 1.5 } })).toThrow();
  });
  it("optional context strings are omitted from the Cedar context when absent and included when present", () => {
    const without = EvaluateInput.parse({ principal: agent(), tool: tool(), business: business("assisted") });
    expect(Object.keys(toContext(without))).not.toContain("recipient");
    const withRecipient = EvaluateInput.parse({
      principal: agent(), tool: tool(), business: business("assisted"),
      context: { recipient: "x@example.com", recipientCountry: "SE", localTimeAtRecipient: "2026-10-05T09:00:00+02:00" },
    });
    const ctx = toContext(withRecipient);
    expect(ctx["recipient"]).toBe("x@example.com");
    expect(ctx["recipientCountry"]).toBe("SE");
    expect(ctx["localTimeAtRecipient"]).toBe("2026-10-05T09:00:00+02:00");
  });
  it("entities carry the tool id <connector>:<name> and the agent is a member of its business", () => {
    const input = EvaluateInput.parse({ principal: agent(), tool: TOOLS.sendEmail, business: business("assisted") });
    const [a, t, b] = toEntities(input);
    expect(t!.uid).toEqual({ type: "Tool", id: "sendgrid:send_email" });
    expect(a!.parents).toEqual([{ type: "Business", id: "biz-1" }]);
    expect(b!.uid).toEqual({ type: "Business", id: "biz-1" });
  });
  it("fails closed when the engine reports an evaluation error", () => {
    const engine = createPolicyEngine();
    const broken = {
      policySet: engine.policySet,
      authorize: () => ({
        type: "success" as const,
        warnings: [],
        response: { decision: "allow" as const, diagnostics: { reason: ["automated-allow-within-caps"], errors: [{ policyId: "hard-gate", error: { message: "boom", help: null, code: null, url: null, severity: null } }] } },
      }),
    };
    const r = evaluate({ principal: agent(), tool: tool(), business: business("automated") }, broken);
    expect(r.outcome).toBe("deny");
    expect(r.policyIds).toContain("hard-gate");
    expect(r.reasons[0]).toMatch(/precaution/);
  });
  it("fails closed when the engine cannot evaluate at all", () => {
    const engine = createPolicyEngine();
    const broken = { policySet: engine.policySet, authorize: () => ({ type: "failure" as const, errors: [{ message: "bad request", help: null, code: null, url: null, severity: null }], warnings: [] }) };
    const r = evaluate({ principal: agent(), tool: tool(), business: business("automated") }, broken);
    expect(r).toEqual({ outcome: "deny", reasons: ["Policy engine could not evaluate the request", "bad request"], policyIds: [] });
  });
  it("is fast enough for the gateway hot path (per-evaluation budget; CI runners get a wider one)", () => {
    // cedar-wasm has no persistent policy-set handle, so every isAuthorized call re-parses the policies:
    // about 1 ms per evaluation on a laptop, 10-20 ms on a shared CI runner. Budget per evaluation so the
    // assertion means the same thing everywhere.
    const n = process.env.CI ? 100 : 1000;
    const budgetMs = process.env.CI ? 60 : 3;
    const start = performance.now();
    for (let i = 0; i < n; i++) run("assisted", TOOLS.adSpend, { amountMinor: i });
    const perEvaluation = (performance.now() - start) / n;
    expect(perEvaluation, `${perEvaluation.toFixed(2)} ms per evaluation`).toBeLessThan(budgetMs);
  });
});

// Keep the unused-import linter honest: EvaluateInputInput is part of the public surface exercised above.
const _typeCheck: EvaluateInputInput = { principal: agent(), tool: tool(), business: business("assisted") };
void _typeCheck;
