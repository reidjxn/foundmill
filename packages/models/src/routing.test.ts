import { describe, expect, it } from "vitest";
import { MODELS, MODEL_CAPABILITIES, ROUTES, resolveModel } from "./routing";

describe("routing (BUILD §10.1)", () => {
  it("MODELS and ROUTES are exactly the spec table", () => {
    expect(MODELS).toEqual({ opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5", haiku: "claude-haiku-4-5-20251001" });
    expect(ROUTES).toEqual({
      inboxComposer: { model: "opus", locked: true },
      planCompiler: { model: "opus", locked: true },
      chiefOfStaff: { model: "opus", warnOnDowngrade: true },
      departmentLead: { model: "opus" },
      planner: { model: "opus" },
      codeReview: { model: "opus" },
      ideation: { model: "opus", effort: "low", speed: "fast" },
      ideationSlate: { model: "opus", effort: "low", speed: "fast" },
      logoDesigner: { model: "opus", effort: "low", speed: "fast" },
      foundations: { model: "opus", effort: "low", speed: "fast" },
      foundationsSkeleton: { model: "opus", effort: "low", speed: "fast" },
      skillGrader: { model: "opus" },
      coach: { model: "opus" },
      worker: { model: "sonnet" },
      journeyCommentary: { model: "sonnet" },
      nightlyBatch: { model: "sonnet", batch: true },
      linker: { model: "haiku" },
      classifier: { model: "haiku" },
      categoriser: { model: "haiku" },
      quarantinedReader: { model: "haiku" },
      moderation: { model: "haiku" },
      conversation: { model: "opus", effort: "low" },
    });
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
    expect(r.warning).toMatch(/locked to opus/);
    expect(resolveModel("planCompiler", "sonnet").modelKey).toBe("opus");
  });

  it("Chief of Staff downgrade applies but warns; upgrade does not warn", () => {
    const down = resolveModel("chiefOfStaff", "sonnet");
    expect(down.modelKey).toBe("sonnet");
    expect(down.warning).toMatch(/Downgrading/);
    const same = resolveModel("chiefOfStaff", "opus");
    expect(same.warning).toBeUndefined();
    const up = resolveModel("worker", "opus");
    expect(up.modelKey).toBe("opus");
    expect(up.warning).toBeUndefined();
  });

  it("first-draft routes stay on Opus at low effort and ask for fast mode; the locked and planning routes keep the API default", () => {
    for (const route of ["ideation", "ideationSlate", "logoDesigner", "foundations", "foundationsSkeleton"] as const) {
      expect(resolveModel(route)).toMatchObject({ modelKey: "opus", effort: "low", speed: "fast" });
    }
    for (const route of ["inboxComposer", "planCompiler", "planner", "coach", "chiefOfStaff"] as const) {
      const r = resolveModel(route);
      expect(r.modelKey).toBe("opus");
      expect(r.effort).toBeUndefined();
      expect(r.speed).toBeUndefined();
    }
  });

  it("conversation replies run on Opus at low effort without fast mode (audit-conversation §4)", () => {
    expect(resolveModel("conversation")).toMatchObject({ route: "conversation", modelKey: "opus", modelId: MODELS.opus, effort: "low", locked: false, batch: false });
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

  it("plain routes accept any override silently", () => {
    expect(resolveModel("codeReview", "haiku")).toMatchObject({ modelKey: "haiku", warning: undefined });
    expect(resolveModel("classifier", "opus").modelId).toBe(MODELS.opus);
  });
});
