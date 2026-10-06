import { describe, expect, it } from "vitest";
import { bestSimilarity, FUZZY_THRESHOLD, similarity, trigrams, trigramWords } from "../index";

describe("trigram similarity (pg_trgm semantics)", () => {
  it("pads words with two leading and one trailing space", () => {
    expect([...trigrams("cat")].sort()).toEqual(["  c", " ca", "at ", "cat"]);
    expect(trigramWords("Meridian-Labs, Inc.")).toEqual(["meridian", "labs", "inc"]);
  });

  it("is 1 for identical strings up to case, punctuation and diacritics; 0 for empty input", () => {
    expect(similarity("Nordic Packaging", "nordic-packaging")).toBe(1);
    expect(similarity("Åkesson", "akesson")).toBe(1);
    expect(similarity("", "x")).toBe(0);
    expect(similarity("", "")).toBe(0);
  });

  it("matches pg_trgm reference values", () => {
    expect(similarity("Northwind Skincare", "Northwind Skincare AB")).toBeCloseTo(0.8636, 3);
    expect(similarity("Lindqvist", "Lindquist")).toBeCloseTo(0.5385, 3);
    expect(similarity("Meridian Labs", "Meridian Labs Inc")).toBeCloseTo(0.7778, 3);
  });

  it("the fuzzy threshold is 0.85 and only tiny variations clear it", () => {
    expect(FUZZY_THRESHOLD).toBe(0.85);
    expect(similarity("Northwind Skincare", "Northwind Skincare AB")).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
    expect(similarity("Meridian Labs", "Meridian Labz")).toBeLessThan(FUZZY_THRESHOLD);
    expect(similarity("Nordic Packaging AB", "Nordic Packaging ABs")).toBeGreaterThanOrEqual(FUZZY_THRESHOLD);
  });

  it("bestSimilarity returns the best candidate", () => {
    expect(bestSimilarity("Meridian Lab", ["Stripe", "Meridian Labs", "Nordic Packaging"])).toEqual({ score: similarity("Meridian Lab", "Meridian Labs"), match: "Meridian Labs" });
    expect(bestSimilarity("x", [])).toEqual({ score: 0, match: null });
  });
});
