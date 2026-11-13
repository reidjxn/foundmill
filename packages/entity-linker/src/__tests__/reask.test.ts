import { describe, expect, it } from "vitest";
import { buildReask, checkComposerText, MAX_REASKS, shouldReask, stripInvalidMentions, validateMarkup } from "../index";
import { FIXTURE_IDS, fixtureManifest, uuidFor } from "../testing";

const m = fixtureManifest();
const ghost = uuidFor("ghost-id");

describe("buildReask", () => {
  it("lists every offending id once, suggests the right id when the display names a manifest entity", () => {
    const text = `[[ent:${ghost}|Meridian Labs]] and [[ent:${ghost}|Meridian Labs]] and [[ent:${uuidFor("other")}|Unknown Co]] and [[ent:${FIXTURE_IDS.hiddenInvestor}|Hidden Investor]].`;
    const v = validateMarkup(text, m);
    const reask = buildReask(v, m);
    expect(reask.offendingIds).toEqual([ghost, uuidFor("other"), FIXTURE_IDS.hiddenInvestor]);
    expect(reask.suggestions).toEqual([
      { display: "Meridian Labs", badId: ghost, suggestedId: FIXTURE_IDS.meridian, reason: "unknown" },
      { display: "Unknown Co", badId: uuidFor("other"), suggestedId: null, reason: "unknown" },
      { display: "Hidden Investor", badId: FIXTURE_IDS.hiddenInvestor, suggestedId: null, reason: "invisible" },
    ]);
    expect(reask.prompt).toContain(`use [[ent:${FIXTURE_IDS.meridian}|Meridian Labs]]`);
    expect(reask.prompt).toContain('"Unknown Co" has no manifest entry');
    expect(reask.prompt).toContain("must not see");
    expect(reask.prompt).toContain(m.text);
    expect(reask.message).toEqual({ role: "user", content: reask.prompt });
  });

  it("mentions malformed markup", () => {
    const v = validateMarkup("[[ent:bad|Broken]] text", m);
    const reask = buildReask(v, m);
    expect(reask.malformed).toEqual(["[[ent:bad|Broken]]"]);
    expect(reask.prompt).toContain("Malformed markup");
  });

  it("is pure: the same input gives the same prompt", () => {
    const v = validateMarkup(`[[ent:${ghost}|X]]`, m);
    expect(buildReask(v, m).prompt).toBe(buildReask(v, m).prompt);
  });

  it("can omit the manifest", () => {
    const v = validateMarkup(`[[ent:${ghost}|X]]`, m);
    expect(buildReask(v, m, { includeManifest: false }).prompt).not.toContain("Manifest (");
  });
});

describe("shouldReask / MAX_REASKS", () => {
  it("allows exactly one re-ask", () => {
    const invalid = validateMarkup(`[[ent:${ghost}|X]]`, m);
    const valid = validateMarkup("fine", m);
    expect(MAX_REASKS).toBe(1);
    expect(shouldReask(invalid, 0)).toBe(true);
    expect(shouldReask(invalid, 1)).toBe(false);
    expect(shouldReask(valid, 0)).toBe(false);
  });
});

describe("stripInvalidMentions (final fallback)", () => {
  it("demotes unknown ids to text, removes invisible mentions, cleans malformed markup, and validates afterwards", () => {
    const text = `[[ent:${ghost}|Ghost Co]] met [[ent:${FIXTURE_IDS.meridian}|Meridian]]. [[ent:${FIXTURE_IDS.hiddenInvestor}|Hidden Investor]] watched. [[ent:bad|Broken]] too.`;
    const out = stripInvalidMentions(text, m);
    expect(out).toBe(`Ghost Co met [[ent:${FIXTURE_IDS.meridian}|Meridian]]. watched. Broken too.`);
    expect(validateMarkup(out, m).valid).toBe(true);
    expect(out).not.toContain("Hidden Investor");
  });

  it("keeps a recovered display as text that cannot become an image or a link (a name a customer chose)", () => {
    const text = `Thanks to [[ent:${ghost}|Ana ![](https://tracker.example/p.png) [offer](https://phish.example)]] for the order.`;
    const out = stripInvalidMentions(text, m);
    expect(out).toContain("Ana");
    expect(out).not.toMatch(/\]\(/);
    expect(out).not.toContain("![");
    expect(validateMarkup(out, m).valid).toBe(true);
    // A long name runs past the 120 characters the malformed opening is reported with: all of it stays inert.
    const long = `Paid by [[ent:${ghost}|Ana Maria ${"de la Cruz ".repeat(8)}![](https://tracker.example/p.png)]] today.`;
    const longOut = stripInvalidMentions(long, m);
    expect(longOut).not.toMatch(/\]\(/);
    expect(longOut).not.toContain("![");
    expect(longOut).toMatch(/today\.$/);
  });

  it("removes only a broken opening that has no display, and never the note after it", () => {
    const text = "See [[ent:abc for the detail. … Pay the VAT bill [[ent:zz|Ana]] by Friday.";
    expect(stripInvalidMentions(text, m)).toBe("See for the detail. … Pay the VAT bill Ana by Friday.");
    expect(stripInvalidMentions("Thanks [[ent:abc and see you Monday.", m)).toBe("Thanks and see you Monday.");
    expect(stripInvalidMentions("[[ent:bad]] Done.", m)).toBe(" Done.");
  });
});

describe("checkComposerText", () => {
  it("returns a re-ask on the first failure and a fallback on the second", () => {
    const text = `[[ent:${ghost}|Ghost Co]] replied.`;
    const first = checkComposerText(text, m, 0);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.reask).not.toBeNull();
      expect(first.fallbackText).toBe("Ghost Co replied.");
    }
    const second = checkComposerText(text, m, 1);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reask).toBeNull();
    const good = checkComposerText(`[[ent:${FIXTURE_IDS.meridian}|Meridian]] replied.`, m);
    expect(good.ok).toBe(true);
  });
});
