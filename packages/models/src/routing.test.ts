import { describe, expect, it } from "vitest";
import { FREE_PLAN_HAIKU_ROUTES, ALWAYS_THINKS, IMAGE_MODELS, VIDEO_MODELS, LOW_EFFORT_MAX_TOKENS, MODELS, MODEL_CAPABILITIES, PLAIN_MAX_TOKENS, ROUTES, THINKING_MAX_TOKENS, lowCreditsModel, maxTokensFor, resolveModel, routeAcceptsImages, type RouteKey, MODEL_ENDPOINTS, MODEL_PROVIDER } from "./routing";

describe("routing (BUILD §10.1)", () => {
  it("MODELS and ROUTES are exactly the spec table", () => {
    expect(MODELS).toEqual({ opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-5-5", glm: "glm-5.3-flash" });
    expect(ROUTES).toEqual({
      inboxComposer: { model: "opus", lowCredits: "keep", locked: true, effort: "low", maxTokens: 16_000 },
      planCompiler: { model: "opus", lowCredits: "keep", locked: true, effort: "low", maxTokens: 16_000 },
      chiefOfStaff: { model: "opus", lowCredits: "keep", warnOnDowngrade: true, effort: "medium", maxTokens: 16_000 },
      departmentLead: { model: "opus", lowCredits: "sonnet", effort: "medium", maxTokens: 16_000 },
      leadRecommendation: { model: "opus", lowCredits: "keep", effort: "low", maxTokens: 16_000 },
      planner: { model: "opus", lowCredits: "sonnet", effort: "low", maxTokens: 16_000 },
      codeReview: { model: "opus", lowCredits: "keep", effort: "medium", maxTokens: 16_000 },
      documentReview: { model: "opus", lowCredits: "keep", effort: "medium", maxTokens: 16_000 },
      ideation: { model: "opus", lowCredits: "keep", effort: "low", speed: "fast", maxTokens: 8_000 },
      ideationSlate: { model: "opus", lowCredits: "keep", effort: "low", speed: "fast", maxTokens: 8_000 },
      logoDesigner: { model: "opus", lowCredits: "sonnet", effort: "low", speed: "fast", maxTokens: 8_000 },
      foundations: { model: "opus", lowCredits: "sonnet", effort: "low", speed: "fast", maxTokens: 8_000 },
      foundationsSkeleton: { model: "opus", lowCredits: "sonnet", effort: "low", speed: "fast", maxTokens: 8_000 },
      skillGrader: { model: "opus", lowCredits: "sonnet", effort: "low", maxTokens: 16_000 },
      coach: { model: "opus", lowCredits: "sonnet", effort: "medium", maxTokens: 16_000 },
      worker: { model: "sonnet", lowCredits: "haiku", effort: "high", maxTokens: 16_000 },
      journeyCommentary: { model: "sonnet", lowCredits: "haiku", effort: "high", maxTokens: 16_000 },
      nightlyBatch: { model: "sonnet", lowCredits: "haiku", batch: true, effort: "high", maxTokens: 16_000 },
      linker: { model: "haiku", lowCredits: "keep", maxTokens: 4_096 },
      classifier: { model: "haiku", lowCredits: "keep", maxTokens: 4_096 },
      categoriser: { model: "haiku", lowCredits: "keep", maxTokens: 4_096 },
      quarantinedReader: { model: "haiku", lowCredits: "keep", maxTokens: 4_096 },
      moderation: { model: "haiku", lowCredits: "keep", maxTokens: 4_096 },
      founderTitle: { model: "haiku", lowCredits: "keep", maxTokens: 4_096 },
      conversation: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: 8_000 },
      goalProposal: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: 8_000 },
      projectPage: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: 8_000 },
      teamCallTurn: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: 8_000 },
      teamCallWrapUp: { model: "opus", lowCredits: "keep", effort: "low", maxTokens: 8_000 },
      designReview: { model: "opus", lowCredits: "keep", effort: "low", vision: true, maxTokens: 8_000 },
      webSearch: { model: "sonnet", lowCredits: "keep", effort: "low", maxTokens: 8_000 },
    });
  });

  it("every route writes its effort down, but the six Haiku utilities (WP-09 T6 step 1; T4 step 2 waits on its live evals)", () => {
    const haikuUtilities = ["linker", "classifier", "categoriser", "quarantinedReader", "moderation", "founderTitle"];
    const without = (Object.entries(ROUTES) as [string, { effort?: string }][]).filter(([, r]) => !r.effort).map(([k]) => k);
    expect(without).toEqual(haikuUtilities);
  });

  it("a route's written effort is what its model's API default was: Opus medium, Sonnet high", () => {
    for (const route of ["chiefOfStaff", "departmentLead", "codeReview", "documentReview", "coach"] as const) expect(resolveModel(route)).toMatchObject({ modelKey: "opus", effort: "medium" });
    // The grader moved to low on a measured agreement (WP-09 T9, run 45221162185).
    expect(resolveModel("skillGrader")).toMatchObject({ modelKey: "opus", effort: "low" });
    for (const route of ["worker", "journeyCommentary", "nightlyBatch"] as const) expect(resolveModel(route)).toMatchObject({ modelKey: "sonnet", effort: "high" });
  });

  it("the goal route (the founder's Change it words) is Sonnet at low effort (founder, 2026-11-07)", () => {
    expect(resolveModel("goalProposal")).toMatchObject({ route: "goalProposal", modelKey: "sonnet", modelId: MODELS.sonnet, effort: "low", locked: false, maxTokens: LOW_EFFORT_MAX_TOKENS });
  });

  it("the project page route (package 1.2) is Sonnet at low effort, not locked", () => {
    expect(resolveModel("projectPage")).toMatchObject({ route: "projectPage", modelKey: "sonnet", modelId: MODELS.sonnet, effort: "low", locked: false, maxTokens: LOW_EFFORT_MAX_TOKENS });
  });

  it("only the design review route carries images (item 13)", () => {
    expect((Object.keys(ROUTES) as (keyof typeof ROUTES)[]).filter(routeAcceptsImages)).toEqual(["designReview"]);
    expect(resolveModel("designReview")).toMatchObject({ modelKey: "opus", effort: "low", locked: false });
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

  it("first-draft routes stay on Opus at low effort and ask for fast mode; the agents' own planning routes write the API default (medium) down", () => {
    for (const route of ["ideation", "ideationSlate", "logoDesigner", "foundations", "foundationsSkeleton"] as const) {
      expect(resolveModel(route)).toMatchObject({ modelKey: "opus", effort: "low", speed: "fast" });
    }
    for (const route of ["coach", "chiefOfStaff", "departmentLead"] as const) {
      const r = resolveModel(route);
      expect(r.modelKey).toBe("opus");
      expect(r.effort).toBe("medium");
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
    // Haiku 5.5 takes effort (WP-13, taking WP-09 T4): an override keeps the route's.
    expect(resolveModel("conversation", "haiku").effort).toBe("low");
  });

  it("drops fast mode when an override moves a route to a model without it, and keeps effort on every current model", () => {
    const haiku = resolveModel("ideation", "haiku");
    expect([haiku.modelKey, haiku.effort, haiku.speed]).toEqual(["haiku", "low", undefined]);
    const sonnet = resolveModel("ideation", "sonnet");
    expect([sonnet.modelKey, sonnet.effort, sonnet.speed]).toEqual(["sonnet", "low", undefined]);
    expect(MODEL_CAPABILITIES).toEqual({
      opus: { effort: true, fastMode: true, temperature: false },
      sonnet: { effort: true, fastMode: false, temperature: false },
      haiku: { effort: true, fastMode: false, temperature: false },
      glm: { effort: true, fastMode: false, temperature: true },
    });
  });

  it("runs the free plan's allowed routes on Haiku 5.5 and keeps every other route on its own model; GLM in a free session; no credit saver (WP-13)", () => {
    for (const route of Object.keys(ROUTES) as RouteKey[]) {
      const free = resolveModel(route, "opus", { lowCredits: true, freePlan: true });
      if (FREE_PLAN_HAIKU_ROUTES.has(route)) expect([free.modelKey, free.modelId, free.warning, free.lowCredits, free.speed]).toEqual(["haiku", MODELS.haiku, undefined, undefined, undefined]);
      // Off the list, a free account runs as routed (Haiku 5.5 leaked injections there, T8): never the credit saver.
      else expect([free.modelKey, free.lowCredits]).toEqual([resolveModel(route, "opus").modelKey, undefined]);
      const session = resolveModel(route, "glm", { lowCredits: true });
      expect([session.modelKey, session.modelId, session.warning, session.lowCredits, session.speed]).toEqual(["glm", MODELS.glm, undefined, undefined, undefined]);
    }
    expect(resolveModel("ideation", undefined, { freePlan: true }).effort).toBe("low");
    // The readers and the agents of a free account keep their models (T8, Nov 17, 2026).
    for (const route of ["quarantinedReader", "worker", "departmentLead", "conversation", "inboxComposer", "planCompiler"] as const) expect(resolveModel(route, undefined, { freePlan: true }).modelKey).toBe(ROUTES[route].model);
    expect([MODEL_PROVIDER.glm, MODEL_PROVIDER.haiku, MODEL_ENDPOINTS.zai.baseURL]).toEqual(["zai", "anthropic", "https://api.z.ai/api/anthropic"]);
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
    // An override onto a thinking model never keeps a utility-sized budget.
    expect(resolveModel("classifier", "opus").maxTokens).toBe(THINKING_MAX_TOKENS);
    expect(resolveModel("classifier", "sonnet").maxTokens).toBe(THINKING_MAX_TOKENS);
    expect(resolveModel("ideation", "sonnet").maxTokens).toBe(LOW_EFFORT_MAX_TOKENS);
    expect(resolveModel("planner", "haiku").maxTokens).toBe(THINKING_MAX_TOKENS);
    expect(maxTokensFor(PLAIN_MAX_TOKENS, "opus")).toBe(THINKING_MAX_TOKENS);
    expect(maxTokensFor(PLAIN_MAX_TOKENS, "opus", "low")).toBe(LOW_EFFORT_MAX_TOKENS);
    expect(maxTokensFor(30_000, "opus", "low")).toBe(30_000);
    // Haiku 5.5 thinks by default too (WP-13): its utility routes get the thinking floor, a cap and not a spend.
    expect(maxTokensFor(PLAIN_MAX_TOKENS, "haiku")).toBe(THINKING_MAX_TOKENS);
    expect(resolveModel("classifier").maxTokens).toBe(THINKING_MAX_TOKENS);
  });

  it("plain routes accept any override silently", () => {
    expect(resolveModel("codeReview", "haiku")).toMatchObject({ modelKey: "haiku", warning: undefined });
    expect(resolveModel("classifier", "opus").modelId).toBe(MODELS.opus);
  });
});

describe("low credits (credit saver)", () => {
  const routes = Object.keys(ROUTES) as RouteKey[];
  const RANK = { glm: 0, haiku: 0, sonnet: 1, opus: 2 } as const;

  it("founder-facing and high-stakes work keeps its model", () => {
    const kept: RouteKey[] = ["inboxComposer", "planCompiler", "chiefOfStaff", "conversation", "leadRecommendation", "codeReview", "projectPage", "goalProposal", "teamCallTurn", "teamCallWrapUp", "quarantinedReader", "moderation"];
    for (const route of kept) {
      expect(lowCreditsModel(route)).toBeNull();
      const r = resolveModel(route, undefined, { lowCredits: true });
      expect(r.modelKey).toBe(ROUTES[route].model);
      expect(r.lowCredits).toBeUndefined();
    }
  });

  it("routine work moves to a lower-cost model, never a higher one, and locked routes never move", () => {
    expect(resolveModel("worker", undefined, { lowCredits: true })).toMatchObject({ modelKey: "haiku", modelId: MODELS.haiku, lowCredits: true });
    expect(resolveModel("departmentLead", undefined, { lowCredits: true })).toMatchObject({ modelKey: "sonnet", lowCredits: true });
    expect(resolveModel("planner", undefined, { lowCredits: true })).toMatchObject({ modelKey: "sonnet", effort: "low", lowCredits: true });
    expect(resolveModel("foundations", undefined, { lowCredits: true }).modelKey).toBe("sonnet");
    for (const route of routes) {
      const moved = lowCreditsModel(route);
      if (moved) expect(RANK[moved]).toBeLessThan(RANK[ROUTES[route].model]);
      if ((ROUTES[route] as { locked?: boolean }).locked) expect(moved).toBeNull();
    }
  });

  it("an agent's own model choice is moved too, unless it is already cheaper", () => {
    expect(resolveModel("worker", "opus", { lowCredits: true }).modelKey).toBe("haiku");
    expect(resolveModel("departmentLead", "haiku", { lowCredits: true })).toMatchObject({ modelKey: "haiku" });
    expect(resolveModel("departmentLead", "haiku", { lowCredits: true }).lowCredits).toBeUndefined();
  });

  it("without low credits nothing changes", () => {
    for (const route of routes) {
      expect(resolveModel(route, undefined, { lowCredits: false })).toEqual(resolveModel(route));
      expect(resolveModel(route).lowCredits).toBeUndefined();
    }
  });
});

describe("video models", () => {
  it("the showcase clip's video model lives here and is not a Claude route", () => {
    expect(VIDEO_MODELS).toEqual({ showcase_clip: "gen4_turbo" });
    expect(Object.keys(ROUTES)).not.toContain("showcase_clip");
  });
});

describe("image models", () => {
  it("the portrait image model lives here and is not a Claude route", () => {
    expect(IMAGE_MODELS).toEqual({ portrait_image: "gpt-image-2.5-flare" });
    expect(Object.keys(ROUTES)).not.toContain("portrait_image");
  });
});
