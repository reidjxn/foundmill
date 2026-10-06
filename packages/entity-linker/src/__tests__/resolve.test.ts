import { describe, expect, it } from "vitest";
import {
  AUTO_MERGE_THRESHOLD,
  createModelScorer,
  decide,
  matchStrongIdentifiers,
  nameSimilarity,
  normalizeIdentifier,
  planMerge,
  resolveIdentity,
  resolveIdentityWithModel,
  scoreNameOrg,
  SUGGEST_THRESHOLD,
  unmerge,
  type IdentityRecord,
  type MergeableEntity,
} from "../index";

const sara: IdentityRecord = { id: "s1", kind: "person", name: "Sara Lindqvist", org: "Meridian Labs", identifiers: { email: "Sara.Lindqvist@Meridian.example" } };

describe("normalizeIdentifier", () => {
  it("canonicalises each strong identifier", () => {
    expect(normalizeIdentifier("email", " Sara@Example.COM ")).toBe("sara@example.com");
    expect(normalizeIdentifier("email", "not an email")).toBeNull();
    expect(normalizeIdentifier("domain", "https://www.Acme.com/pricing?x=1")).toBe("acme.com");
    expect(normalizeIdentifier("domain", "sara@acme.com")).toBe("acme.com");
    expect(normalizeIdentifier("domain", "localhost")).toBeNull();
    expect(normalizeIdentifier("linkedin", "https://se.linkedin.com/in/Sara-Lindqvist/?trk=x")).toBe("linkedin.com/in/sara-lindqvist");
    expect(normalizeIdentifier("linkedin", "sara-lindqvist")).toBe("linkedin.com/in/sara-lindqvist");
    expect(normalizeIdentifier("linkedin", "https://linkedin.com/company/meridian-labs")).toBe("linkedin.com/company/meridian-labs");
    expect(normalizeIdentifier("reg_no", "556 123-4567")).toBe("5561234567");
    expect(normalizeIdentifier("stripe_id", "cus_Nffrfe12345678")).toBe("cus_Nffrfe12345678");
    expect(normalizeIdentifier("stripe_id", "nope")).toBeNull();
    expect(normalizeIdentifier("email", null)).toBeNull();
  });
});

describe("strong identifiers first", () => {
  it("matches on e-mail regardless of case and merges", () => {
    const existing: IdentityRecord[] = [{ id: "e1", kind: "person", name: "S. Lindquist", identifiers: { email: "sara.lindqvist@meridian.example" } }];
    const r = resolveIdentity(sara, existing);
    expect(r.decision).toBe("merge");
    expect(r.match).toMatchObject({ id: "e1", score: 1, matchedOn: "identifier", identifiers: ["email"] });
  });

  it("matches organisations on domain, registration number and Stripe id", () => {
    const acme: IdentityRecord = { kind: "organisation", name: "ACME Corporation", identifiers: { domain: "https://acme.com", reg_no: "556123-4567", stripe_id: "cus_Abcdefgh1234" } };
    expect(matchStrongIdentifiers(acme, { kind: "organisation", name: "Acme Corp.", identifiers: { domain: "www.acme.com" } })).toEqual(["domain"]);
    expect(matchStrongIdentifiers(acme, { kind: "organisation", name: "Something Else", identifiers: { reg_no: "5561234567" } })).toEqual(["reg_no"]);
    expect(matchStrongIdentifiers(acme, { kind: "organisation", name: "Different", identifiers: { stripe_id: "cus_Abcdefgh1234" } })).toEqual(["stripe_id"]);
    expect(resolveIdentity(acme, [{ id: "o1", kind: "organisation", name: "Different", identifiers: { stripe_id: "cus_Abcdefgh1234" } }]).decision).toBe("merge");
  });

  it("a shared company domain does not merge two different people", () => {
    const a: IdentityRecord = { kind: "person", name: "Sara Lindqvist", identifiers: { domain: "meridian.example" } };
    const b: IdentityRecord = { kind: "person", name: "Johan Berg", identifiers: { domain: "meridian.example" } };
    expect(matchStrongIdentifiers(a, b)).toEqual([]);
    expect(resolveIdentity(a, [b]).decision).toBe("none");
  });

  it("a strong identifier across kinds only suggests", () => {
    const r = resolveIdentity(sara, [{ id: "o1", kind: "organisation", name: "Meridian Labs", identifiers: { email: "sara.lindqvist@meridian.example" } }]);
    expect(r.decision).toBe("suggest");
    expect(r.match?.matchedOn).toBe("identifier");
  });

  it("never matches a record with itself", () => {
    expect(resolveIdentity(sara, [sara]).decision).toBe("none");
  });
});

describe("fuzzy name + org score and thresholds", () => {
  it("thresholds are 0.95 and 0.75 and the boundary counts as reached", () => {
    expect(AUTO_MERGE_THRESHOLD).toBe(0.95);
    expect(SUGGEST_THRESHOLD).toBe(0.75);
    expect(decide(0.95)).toBe("merge");
    expect(decide(0.9499)).toBe("suggest");
    expect(decide(0.75)).toBe("suggest");
    expect(decide(0.7499)).toBe("none");
  });

  it("same person name at the same organisation auto-merges", () => {
    const r = resolveIdentity(sara, [{ id: "p1", kind: "person", name: "Lindqvist, Sara", org: "Meridian Labs" }]);
    expect(r.match?.score).toBeGreaterThanOrEqual(0.95);
    expect(r.decision).toBe("merge");
  });

  it("same person name without organisation context only suggests (two John Smiths)", () => {
    const r = resolveIdentity({ kind: "person", name: "John Smith" }, [{ id: "p1", kind: "person", name: "John Smith" }]);
    expect(r.decision).toBe("suggest");
    expect(r.match?.score).toBe(0.9);
  });

  it("same name at a different organisation is a suggestion, not a merge", () => {
    const r = resolveIdentity(sara, [{ id: "p2", kind: "person", name: "Sara Lindqvist", org: "Nordic Packaging AB" }]);
    expect(r.decision).toBe("suggest");
    expect(r.match?.score).toBeLessThan(0.95);
    expect(r.match?.score).toBeGreaterThanOrEqual(0.75);
  });

  it("initials and reordering are recognised", () => {
    expect(nameSimilarity("S. Lindqvist", "Sara Lindqvist")).toBe(0.9);
    expect(nameSimilarity("Lindqvist, Sara", "Sara Lindqvist")).toBe(1);
    expect(nameSimilarity("Sara Lindqvist", "Johan Berg")).toBeLessThan(0.3);
  });

  it("organisations score on name alone, and different kinds never match", () => {
    expect(scoreNameOrg({ kind: "organisation", name: "Meridian Labs" }, { kind: "organisation", name: "Meridian Labs AB" }).score).toBeGreaterThanOrEqual(0.75);
    expect(scoreNameOrg({ kind: "organisation", name: "Meridian Labs" }, { kind: "person", name: "Meridian Labs" }).score).toBe(0);
    expect(resolveIdentity({ kind: "organisation", name: "Meridian Labs" }, [{ id: "o", kind: "organisation", name: "Meridian Labs" }]).decision).toBe("merge");
    expect(resolveIdentity({ kind: "organisation", name: "Meridian Labs" }, [{ id: "o", kind: "organisation", name: "Stripe" }]).decision).toBe("none");
  });

  it("ranks candidates best first and lists every one above the suggest threshold", () => {
    const r = resolveIdentity(sara, [
      { id: "far", kind: "person", name: "Johan Berg" },
      { id: "near", kind: "person", name: "Sara Lindqvist", org: "Nordic Packaging AB" },
      { id: "same", kind: "person", name: "Sara Lindqvist", org: "Meridian Labs" },
    ]);
    expect(r.candidates.map((c) => c.id)).toEqual(["same", "near"]);
    expect(r.decision).toBe("merge");
  });
});

describe("resolveIdentityWithModel", () => {
  const nearMiss: IdentityRecord[] = [{ id: "p", kind: "person", name: "Sara Lindqvist", org: "Nordic Packaging AB" }];

  it("averages the model score into the fuzzy band and cannot invent a match", async () => {
    const confirm = await resolveIdentityWithModel(sara, nearMiss, { modelScore: async () => 1 });
    const local = resolveIdentity(sara, nearMiss);
    expect(confirm.match?.score).toBeGreaterThan(local.match?.score ?? 0);
    const deny = await resolveIdentityWithModel(sara, nearMiss, { modelScore: async () => 0 });
    expect(deny.decision).toBe("none");
    const nothing = await resolveIdentityWithModel({ kind: "person", name: "Zed Quux" }, nearMiss, { modelScore: async () => 1 });
    expect(nothing.decision).toBe("none");
  });

  it("falls back to the local score when the model fails or returns null", async () => {
    const local = resolveIdentity(sara, nearMiss);
    const failed = await resolveIdentityWithModel(sara, nearMiss, { modelScore: async () => Promise.reject(new Error("down")) });
    expect(failed.match?.score).toBe(local.match?.score);
    const none = await resolveIdentityWithModel(sara, nearMiss, { modelScore: async () => null });
    expect(none.match?.score).toBe(local.match?.score);
  });

  it("createModelScorer returns no opinion in mock mode and parses a live answer", async () => {
    const mock = createModelScorer({ mode: "mock", complete: async <T,>() => ({ text: "{}", json: { same_entity_probability: 0.99, reason: "synthetic" } as T }) });
    expect(await mock?.(sara, nearMiss[0] as IdentityRecord)).toBeNull();
    const live = createModelScorer({ mode: "live", complete: async <T,>() => ({ text: "", json: { same_entity_probability: 0.8, reason: "same employer history" } as T }) });
    expect(await live?.(sara, nearMiss[0] as IdentityRecord)).toBe(0.8);
    const broken = createModelScorer({ mode: "live", complete: async () => Promise.reject(new Error("429")) });
    expect(await broken?.(sara, nearMiss[0] as IdentityRecord)).toBeNull();
  });
});

describe("planMerge / unmerge (enrichment fills empty fields only; reversible)", () => {
  const kept: MergeableEntity = { id: "k", kind: "person", name: "Sara Lindqvist", aliases: ["Sara"], identifiers: { email: "sara@meridian.example" }, org: "Meridian Labs", avatarUrl: null, lawfulBasis: "contract" };
  const merged: MergeableEntity = { id: "m", kind: "person", name: "S. Lindqvist", aliases: ["Lindqvist"], identifiers: { email: "other@meridian.example", linkedin: "linkedin.com/in/sara-lindqvist" }, org: "Meridian Labs AB", avatarUrl: "https://img/x.png", lawfulBasis: "consent" };

  it("fills only empty fields, unions aliases (adding the merged name) and identifiers", () => {
    const plan = planMerge(kept, merged);
    expect(plan.kept.avatarUrl).toBe("https://img/x.png");
    expect(plan.kept.lawfulBasis).toBe("contract");
    expect(plan.kept.org).toBe("Meridian Labs");
    expect(plan.kept.identifiers).toEqual({ email: "sara@meridian.example", linkedin: "linkedin.com/in/sara-lindqvist" });
    expect(plan.kept.aliases).toEqual(["Sara", "S. Lindqvist", "Lindqvist"]);
    expect(plan.kept.id).toBe("k");
    expect(plan.kept.name).toBe("Sara Lindqvist");
    expect(plan.changes.map((c) => c.field).sort()).toEqual(["aliases", "avatarUrl", "identifiers"]);
  });

  it("does not mutate its inputs and unmerge restores both records exactly (AC-11.12.3)", () => {
    const keptBefore = structuredClone(kept);
    const mergedBefore = structuredClone(merged);
    const plan = planMerge(kept, merged);
    expect(kept).toEqual(keptBefore);
    expect(merged).toEqual(mergedBefore);
    const restored = unmerge(plan.snapshot);
    expect(restored.kept).toEqual(keptBefore);
    expect(restored.merged).toEqual(mergedBefore);
    expect(JSON.parse(JSON.stringify(plan.snapshot))).toEqual({ kept: keptBefore, merged: mergedBefore });
  });
});
