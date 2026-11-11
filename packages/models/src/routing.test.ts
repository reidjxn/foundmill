import { describe, expect, it } from "vitest";
import { ALWAYS_THINKS, IMAGE_MODELS, LOW_EFFORT_MAX_TOKENS, MODELS, MODEL_CAPABILITIES, PLAIN_MAX_TOKENS, ROUTES, THINKING_MAX_TOKENS, maxTokensFor, resolveModel } from "./routing";

describe("routing (BUILD §10.1)", () => {
  it("MODELS and ROUTES are exactly the spec table", () => {
    expect(MODELS).toEqual({ opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-4-5-20251001" });
    expect(ROUTES).toEqual({
      inboxComposer: { model: "opus", locked: true, effort: "low", maxTokens: 16_000 },
      planCompiler: { model: "opus", locked: true, effort: "low", maxTokens: 16_000 },
      chiefOfStaff: { model: "opus", warnOnDowngrade: true, maxTokens: 16_000 },
      departmentLead: { model: "opus", maxTokens: 16_000 },
      leadRecommendation: { model: "opus", effort: "low", maxTokens: 16_000 },
      planner: { model: "opus", effort: "low", maxTokens: 16_000 },
      codeReview: { model: "opus", maxTokens: 16_000 },
      ideation: { model: "opus", effort: "low", speed: "fast", maxTokens: 8_000 },
      ideationSlate: { model: "opus", effort: "low", speed: "fast", maxTokens: 8_000 },
      logoDesigner: { model: "opus", effort: "low", speed: "fast", maxTokens: 8_000 },
      foundations: { model: "opus", effort: "low", speed: "fast", maxTokens: 8_000 },
      foundationsSkeleton: { model: "opus", effort: "low", speed: "fast", maxTokens: 8_000 },
      skillGrader: { model: "opus", maxTokens: 16_000 },
      coach: { model: "opus", maxTokens: 16_000 },
      worker: { model: "sonnet", maxTokens: 16_000 },
      journeyCommentary: { model: "sonnet", maxTokens: 16_000 },
      nightlyBatch: { model: "sonnet", batch: true, maxTokens: 16_000 },
      linker: { model: "haiku", maxTokens: 4_096 },
      classifier: { model: "haiku", maxTokens: 4_096 },
      categoriser: { model: "haiku", maxTokens: 4_096 },
      quarantinedReader: { model: "haiku", maxTokens: 4_096 },
      moderation: { model: "haiku", maxTokens: 4_096 },
      founderTitle: { model: "haiku", maxTokens: 4_096 },
      conversation: { model: "sonnet", effort: "low", maxTokens: 8_000 },
      goalProposal: { model: "sonnet", effort: "low", maxTokens: 8_000 },
      projectPage: { model: "sonnet", effort: "low", maxTokens: 8_000 },
    });
  });

  it("the goal route (the founder's Change it words) is Sonnet at low effort (founder, 2026-11-07)", () => {
    expect(resolveModel("goalProposal")).toMatchObject({ route: "goalProposal", modelKey: "sonnet", modelId: MODELS.sonnet, effort: "low", locked: false, maxTokens: LOW_EFFORT_MAX_TOKENS });
  });

  it("the project page route (package 1.2) is Sonnet at low effort, not locked", () => {
    expect(resolveModel("projectPage")).toMatchObject({ route: "projectPage", modelKey: "sonnet", modelId: MODELS.sonnet, effort: "low", locked: false, maxTokens: LOW_EFFORT_MAX_TOKENS });
  });

  it("resolves the default model for a route", () => {
    expect(resolveModel("worker")).toMatchObject({ route: "worker", modelKey: "sonnet", modelId: MODELS.sonnet, locked: false, batch: false });
    expect(resolveModel("nightlyBatch").batch).toBe(true);
    expect(resolveModel("linker").modelId).toBe(MODELS.haiku);
  });

  it("locked routes ignore overrides and explain why (Inbox always Opus)", () => {
    const r = resolveModel("inboxComposer", "haiku");
    expect(r.modelKey).toBe("opus");
    expect(r.locked).toBe(true);
    expect(r.warning).toMatch(/locked to Opus/);
    expect(resolveModel("planCompiler", "sonnet").modelKey).toBe("opus");
  });

  it("Chief of Staff downgrade applies but warns; upgrade does not warn", () => {
    const down = resolveModel("chiefOfStaff", "sonnet");
    expect(down.modelKey).toBe("sonnet");
    expect(down.warning).toMatch(/lowers the quality of planning and routing/);
    expect(down.warning).not.toMatch(/"/);
    const same = resolveModel("chiefOfStaff", "opus");
    expect(same.warning).toBeUndefined();
    const up = resolveModel("worker", "opus");
    expect(up.modelKey).toBe("opus");
    expect(up.warning).toBeUndefined();
  });

  it("first-draft routes stay on Opus at low effort and ask for fast mode; the agents' own planning routes keep the API default", () => {
    for (const route of ["ideation", "ideationSlate", "logoDesigner", "foundations", "foundationsSkeleton"] as const) {
      expect(resolveModel(route)).toMatchObject({ modelKey: "opus", effort: "low", speed: "fast" });
    }
    for (const route of ["coach", "chiefOfStaff", "departmentLead"] as const) {
      const r = resolveModel(route);
      expect(r.modelKey).toBe("opus");
      expect(r.effort).toBeUndefined();
      expect(r.speed).toBeUndefined();
    }
  });

  it("what the founder waits on runs at low effort on Opus, with the budget left at the thinking ceiling (founder, 2026-10-15)", () => {
    for (const route of ["inboxComposer", "planCompiler", "planner", "leadRecommendation"] as const) {
      const r = resolveModel(route);
      expect([r.modelKey, r.effort, r.speed, r.maxTokens]).toEqual(["opus", "low", undefined, 16_000]);
    }
    expect(resolveModel("inboxComposer", "sonnet").modelKey).toBe("opus");
  });

  it("conversation replies run on Sonnet at low effort without fast mode (founder, 2026-10-15)", () => {
    expect(resolveModel("conversation")).toMatchObject({ route: "conversation", modelKey: "sonnet", modelId: MODELS.sonnet, effort: "low", locked: false, batch: false, maxTokens: 8_000 });
    expect(resolveModel("conversation").speed).toBeUndefined();
    expect(resolveModel("conversation", "haiku").effort).toBeUndefined();
  });

  it("drops effort and fast mode when an override moves a route to a model without them", () => {
    const haiku = resolveModel("ideation", "haiku");
    expect([haiku.modelKey, haiku.effort, haiku.speed]).toEqual(["haiku", undefined, undefined]);
    const sonnet = resolveModel("ideation", "sonnet");
    expect([sonnet.modelKey, sonnet.effort, sonnet.speed]).toEqual(["sonnet", "low", undefined]);
    expect(MODEL_CAPABILITIES).toEqual({ opus: { effort: true, fastMode: true }, sonnet: { effort: true, fastMode: false }, haiku: { effort: false, fastMode: false } });
  });

  it("sizes max_tokens for the reply plus the thinking the resolved model always does (audit CML-03)", () => {
    // Opus 5.5 always thinks (default effort medium) and Sonnet 5.5 too (default high): the thinking counts toward
    // max_tokens, so every route a planner, a department lead, the Chief of Staff or the composer uses has room for it.
    for (const route of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
      const r = resolveModel(route);
      if (!ALWAYS_THINKS[r.modelKey]) expect(r.maxTokens).toBe(PLAIN_MAX_TOKENS);
      // A low-effort route may keep the thinking ceiling: max_tokens is only a cap (the founder-facing planning routes).
      else expect(r.maxTokens).toBe(Math.max(ROUTES[route].maxTokens, r.effort === "low" ? LOW_EFFORT_MAX_TOKENS : THINKING_MAX_TOKENS));
    }
    expect(THINKING_MAX_TOKENS).toBeGreaterThanOrEqual(12_000);
    // An override onto a thinking model never keeps a Haiku-sized budget; one onto Haiku keeps the route's.
    expect(resolveModel("classifier", "opus").maxTokens).toBe(THINKING_MAX_TOKENS);
    expect(resolveModel("classifier", "sonnet").maxTokens).toBe(THINKING_MAX_TOKENS);
    expect(resolveModel("ideation", "sonnet").maxTokens).toBe(LOW_EFFORT_MAX_TOKENS);
    expect(resolveModel("planner", "haiku").maxTokens).toBe(THINKING_MAX_TOKENS);
    expect(maxTokensFor(PLAIN_MAX_TOKENS, "opus")).toBe(THINKING_MAX_TOKENS);
    expect(maxTokensFor(PLAIN_MAX_TOKENS, "opus", "low")).toBe(LOW_EFFORT_MAX_TOKENS);
    expect(maxTokensFor(30_000, "opus", "low")).toBe(30_000);
    expect(maxTokensFor(PLAIN_MAX_TOKENS, "haiku")).toBe(PLAIN_MAX_TOKENS);
  });

  it("plain routes accept any override silently", () => {
    expect(resolveModel("codeReview", "haiku")).toMatchObject({ modelKey: "haiku", warning: undefined });
    expect(resolveModel("classifier", "opus").modelId).toBe(MODELS.opus);
  });
});

describe("image models", () => {
  it("the portrait image model lives here and is not a Claude route", () => {
    expect(IMAGE_MODELS).toEqual({ portrait_image: "gpt-image-2.5-flare" });
    expect(Object.keys(ROUTES)).not.toContain("portrait_image");
  });
});
