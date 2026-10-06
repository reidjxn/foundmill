import { describe, expect, it, vi } from "vitest";
import { buildManifest, guessKind, serializeSegments, sweep, validateMarkup, type LinkerModelClient } from "../index";
import { FIXTURE_IDS, fixtureManifest } from "../testing";

const m = fixtureManifest();
const MER = FIXTURE_IDS.meridian;

/** A stub model client that answers with a fixed resolution list (or throws). */
function stubClient(answer: unknown | Error, mode: "mock" | "live" = "live"): LinkerModelClient & { calls: number } {
  const client = {
    mode,
    calls: 0,
    async complete<T>() {
      client.calls++;
      if (answer instanceof Error) throw answer;
      return { text: JSON.stringify(answer), json: answer as T };
    },
  };
  return client;
}

describe("sweep: local tiers", () => {
  it("links exact names, aliases and leaves existing markup untouched", async () => {
    const text = `[[ent:${MER}|Meridian Labs]] confirmed the order. Nordic Packaging AB ships on Monday and Meridian pays Stripe.`;
    const r = await sweep(text, m);
    expect(r.usedModel).toBe(false);
    expect(r.linked.map((l) => [l.text, l.id, l.source])).toEqual([
      ["Nordic Packaging AB", FIXTURE_IDS.nordicPackaging, "exact"],
      ["Meridian", MER, "alias"],
      ["Stripe", FIXTURE_IDS.stripe, "exact"],
    ]);
    expect(r.text).toBe(`[[ent:${MER}|Meridian Labs]] confirmed the order. [[ent:${FIXTURE_IDS.nordicPackaging}|Nordic Packaging AB]] ships on Monday and [[ent:${MER}|Meridian]] pays [[ent:${FIXTURE_IDS.stripe}|Stripe]].`);
    expect(validateMarkup(r.text, m).valid).toBe(true);
    expect(r.ambiguous).toEqual([]);
    expect(r.drafts).toEqual([]);
  });

  it("links fuzzy variants at trigram similarity >= 0.85 and reports the score", async () => {
    const fuzzyManifest = buildManifest([{ id: FIXTURE_IDS.nordicPackaging, kind: "organisation", name: "Northwind Skincare AB" }]);
    const r = await sweep("Northwind Skincare signed the lease with Northwind Skincare ABs.", fuzzyManifest);
    expect(r.linked.map((l) => [l.text, l.id, l.source])).toEqual([
      ["Northwind Skincare", FIXTURE_IDS.nordicPackaging, "fuzzy"],
      ["Northwind Skincare ABs", FIXTURE_IDS.nordicPackaging, "fuzzy"],
    ]);
    expect(r.linked[0]?.confidence).toBeCloseTo(0.864, 2);
    expect(r.linked.every((l) => l.confidence >= 0.85 && l.confidence <= 0.9)).toBe(true);
    expect(r.drafts).toEqual([]);
  });

  it("exact beats fuzzy: a name followed by a legal suffix links the name and leaves the suffix", async () => {
    const r = await sweep("Northwind Skincare AB signed.", buildManifest([{ id: MER, kind: "organisation", name: "Northwind Skincare" }]));
    expect(r.linked.map((l) => [l.text, l.source])).toEqual([["Northwind Skincare", "exact"]]);
    expect(r.text).toBe(`[[ent:${MER}|Northwind Skincare]] AB signed.`);
    expect(r.drafts).toEqual([]);
  });

  it("links names and aliases that contain lowercase words, as written", async () => {
    const r = await sweep("Ask the Distribution lead or the Chief of Staff; Astrid knows.", m);
    expect(r.linked.map((l) => [l.text, l.id, l.source])).toEqual([
      ["Distribution lead", FIXTURE_IDS.distributionLead, "alias"],
      ["Chief of Staff", FIXTURE_IDS.chiefOfStaff, "alias"],
      ["Astrid", FIXTURE_IDS.chiefOfStaff, "exact"],
    ]);
  });

  it("an alias written in lowercase as a common noun is not linked", async () => {
    const r = await sweep("The glow of the screen; Glow replied.", m);
    expect(r.linked.map((l) => l.text)).toEqual(["Glow"]);
  });

  it("does not fuzzy-link below the threshold (becomes a draft)", async () => {
    const r = await sweep("Meridian Labz sent a quote.", buildManifest([{ id: MER, kind: "organisation", name: "Meridian Labs" }]));
    expect(r.linked).toEqual([]);
    expect(r.drafts.map((d) => d.name)).toEqual(["Meridian Labz"]);
  });

  it("the threshold is configurable", async () => {
    const r = await sweep("Meridian Labz sent a quote.", buildManifest([{ id: MER, kind: "organisation", name: "Meridian Labs" }]), null, { fuzzyThreshold: 0.6 });
    expect(r.linked.map((l) => l.source)).toEqual(["fuzzy"]);
  });

  it("links a lone surname or first name when exactly one entity has it (partial tier)", async () => {
    const r = await sweep("Lindqvist approved the samples; Johan will call Novak.", m);
    expect(r.linked.map((l) => [l.text, l.id, l.source])).toEqual([
      ["Lindqvist", FIXTURE_IDS.saraLindqvist, "partial"],
      ["Johan", FIXTURE_IDS.johanBerg, "partial"],
      ["Novak", FIXTURE_IDS.saraNovak, "partial"],
    ]);
    expect(r.linked.every((l) => l.confidence === 0.75)).toBe(true);
  });

  it("partial matching can be switched off", async () => {
    const r = await sweep("Johan will call.", m, null, { linkPartialMatches: false, draftUnknown: false });
    expect(r.linked).toEqual([]);
    expect(r.segments).toEqual([{ kind: "text", text: "Johan will call." }]);
  });

  it("handles possessives, abbreviations and hyphenated spellings", async () => {
    const r = await sweep("Meridian's team met S. Novak; Nordic-Packaging shipped.", m);
    expect(r.linked.map((l) => [l.text, l.id])).toEqual([
      ["Meridian", MER],
      ["S. Novak", FIXTURE_IDS.saraNovak],
      ["Nordic-Packaging", FIXTURE_IDS.nordicPackaging],
    ]);
    expect(r.text).toContain(`[[ent:${MER}|Meridian]]'s team`);
  });

  it("round-trips: serialising the segments gives the returned text", async () => {
    const text = `Sara from [[ent:${MER}|Meridian]] and Acme Robotics Inc. met Stripe.`;
    const r = await sweep(text, m);
    expect(serializeSegments(r.segments)).toBe(r.text);
    expect(r.segments.map((s) => s.kind)).toEqual(["ambiguous", "text", "entity", "text", "draft", "text", "entity", "text"]);
  });
});

describe("sweep: ambiguity", () => {
  it("flags a span that matches several entities with candidates", async () => {
    const r = await sweep("Sara will follow up.", m);
    expect(r.linked).toEqual([]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0]?.text).toBe("Sara");
    expect(r.ambiguous[0]?.candidates.map((c) => c.id).sort()).toEqual([FIXTURE_IDS.saraLindqvist, FIXTURE_IDS.saraNovak].sort());
    expect(r.segments[0]).toMatchObject({ kind: "ambiguous", text: "Sara" });
    // Ambiguous spans stay plain text in the output text: never a guessed link.
    expect(r.text).toBe("Sara will follow up.");
  });

  it("flags a shared alias as ambiguous", async () => {
    const shared = buildManifest([
      { id: "a", kind: "person", name: "Sara Lindqvist", aliases: ["Sara"] },
      { id: "b", kind: "person", name: "Sara Novak", aliases: ["Sara"] },
    ]);
    const r = await sweep("Ping Sara today.", shared);
    expect(r.ambiguous[0]?.candidates.map((c) => c.tier)).toEqual(["alias", "alias"]);
  });

  it("uses the model only for ambiguous spans and accepts a confident answer from the candidate set", async () => {
    const client = stubClient({ resolutions: [{ index: 0, entity_id: FIXTURE_IDS.saraLindqvist, confidence: 0.95 }] });
    const r = await sweep("Sara from Meridian will follow up.", m, client);
    expect(client.calls).toBe(1);
    expect(r.usedModel).toBe(true);
    expect(r.modelResolved).toBe(1);
    expect(r.ambiguous).toEqual([]);
    expect(r.linked.map((l) => [l.text, l.id, l.source])).toEqual([
      ["Sara", FIXTURE_IDS.saraLindqvist, "model"],
      ["Meridian", MER, "alias"],
    ]);
    expect(r.text).toBe(`[[ent:${FIXTURE_IDS.saraLindqvist}|Sara]] from [[ent:${MER}|Meridian]] will follow up.`);
  });

  it("does not call the model when nothing is ambiguous", async () => {
    const client = stubClient({ resolutions: [] });
    await sweep("Meridian Labs replied.", m, client);
    expect(client.calls).toBe(0);
  });

  it("rejects a model answer that is not one of the candidates, below confidence, or null", async () => {
    for (const answer of [
      { resolutions: [{ index: 0, entity_id: FIXTURE_IDS.stripe, confidence: 1 }] },
      { resolutions: [{ index: 0, entity_id: FIXTURE_IDS.saraLindqvist, confidence: 0.5 }] },
      { resolutions: [{ index: 0, entity_id: null, confidence: 1 }] },
      { resolutions: [{ index: 7, entity_id: FIXTURE_IDS.saraLindqvist, confidence: 1 }] },
    ]) {
      const r = await sweep("Sara will follow up.", m, stubClient(answer));
      expect(r.usedModel).toBe(true);
      expect(r.modelResolved).toBe(0);
      expect(r.ambiguous).toHaveLength(1);
      expect(r.text).toBe("Sara will follow up.");
    }
  });

  it("works offline in mock mode: a synthetic answer leaves the span ambiguous, and a failing client never throws", async () => {
    const synthetic = stubClient({ resolutions: [{ index: 0, entity_id: "11111111-2222-4333-a444-555555555555", confidence: 0.99 }] }, "mock");
    const r1 = await sweep("Sara will follow up.", m, synthetic);
    expect(r1.ambiguous).toHaveLength(1);
    expect(r1.modelResolved).toBe(0);

    const failing = stubClient(new Error("network down"));
    const r2 = await sweep("Sara will follow up.", m, failing);
    expect(r2.ambiguous).toHaveLength(1);
    expect(r2.modelError).toBe("network down");

    const garbage = { mode: "mock" as const, complete: vi.fn(async () => ({ text: "not json" })) };
    const r3 = await sweep("Sara will follow up.", m, garbage);
    expect(r3.ambiguous).toHaveLength(1);
    expect(r3.modelError).toMatch(/no parsable/);
  });

  it("can be told not to use the model", async () => {
    const client = stubClient({ resolutions: [{ index: 0, entity_id: FIXTURE_IDS.saraLindqvist, confidence: 1 }] });
    const r = await sweep("Sara will follow up.", m, client, { resolveAmbiguousWithModel: false });
    expect(client.calls).toBe(0);
    expect(r.ambiguous).toHaveLength(1);
  });
});

describe("sweep: drafts", () => {
  it("drafts unknown proper nouns with a kind guess and counts occurrences", async () => {
    const r = await sweep("Acme Robotics Inc. asked for samples. Dr Elin Åkesson agreed, and Acme Robotics Inc. confirmed.", m);
    expect(r.drafts).toEqual([
      { name: "Acme Robotics Inc.", kindGuess: "organisation", occurrences: 2 },
      { name: "Elin Åkesson", kindGuess: "person", occurrences: 1 },
    ]);
    expect(r.segments.filter((s) => s.kind === "draft")).toHaveLength(3);
    // Drafts never become markup.
    expect(r.text).toBe("Acme Robotics Inc. asked for samples. Dr Elin Åkesson agreed, and Acme Robotics Inc. confirmed.");
  });

  it("does not draft sentence openers, interface nouns, acronyms, calendar words or ignored names", async () => {
    const r = await sweep("The Inbox shows the CPA moved on Monday. Continue is blocked until Q3. Northwind Skincare paid EUR. Forecast: fine.", m, null, { ignore: ["Northwind Skincare"] });
    expect(r.drafts).toEqual([]);
    expect(r.linked).toEqual([]);
  });

  it("keeps a real multi-word name at a sentence start and an acronym mid-sentence", async () => {
    const r = await sweep("Helios Energy GmbH called. We asked IKEA for a quote.", m);
    expect(r.drafts.map((d) => [d.name, d.kindGuess])).toEqual([
      ["Helios Energy GmbH", "organisation"],
      ["IKEA", "organisation"],
    ]);
  });

  it("ignores URLs, e-mail addresses, code spans and link targets", async () => {
    const r = await sweep("See https://Meridian.example/Docs and `Stripe` or mail Sara@Example.com or [Meridian Labs](https://example.com/Meridian).", m);
    expect(r.linked.map((l) => l.text)).toEqual(["Meridian Labs"]);
    expect(r.drafts).toEqual([]);
  });

  it("drafting can be switched off", async () => {
    const r = await sweep("Acme Robotics Inc. called.", m, null, { draftUnknown: false });
    expect(r.drafts).toEqual([]);
    expect(r.segments).toEqual([{ kind: "text", text: "Acme Robotics Inc. called." }]);
  });

  it("guessKind: markers, given names, surname suffixes, default", () => {
    expect(guessKind(["acme", "robotics", "inc"])).toBe("organisation");
    expect(guessKind(["sara", "lindqvist"])).toBe("person");
    expect(guessKind(["elin", "akesson"])).toBe("person");
    expect(guessKind(["x", "y"], true)).toBe("person");
    expect(guessKind(["meridian"])).toBe("organisation");
  });
});

describe("sweep: never links the business's own name used generically or invisible entities", () => {
  it("ignore list suppresses links and drafts", async () => {
    const r = await sweep("Meridian Labs and Glow replied.", m, null, { ignore: ["Meridian Labs", "glow"] });
    expect(r.linked).toEqual([]);
    expect(r.drafts).toEqual([]);
  });

  it("an invisible entity is never linked or offered as a candidate", async () => {
    const r = await sweep("Hidden Investor wrote back.", m);
    expect(r.linked).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    // It is unknown to the founder, so it is treated like any other unknown name.
    expect(r.drafts.map((d) => d.name)).toEqual(["Hidden Investor"]);
  });
});
