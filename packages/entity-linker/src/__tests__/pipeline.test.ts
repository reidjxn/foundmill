import { describe, expect, it } from "vitest";
import { checkComposerText, linkComposerText, validateMarkup, type LinkerModelClient } from "../index";
import { FIXTURE_IDS, fixtureManifest, uuidFor } from "../testing";

const m = fixtureManifest();

/** Simulates the composer's two model turns: first with a bad id, then fixed after the re-ask. */
describe("composer protocol: validate → re-ask once → sweep → render", () => {
  it("runs end to end", async () => {
    const ghost = uuidFor("ghost");
    const firstOutput = `[[ent:${ghost}|Meridian Labs]] confirmed the quote; Sara will follow up with Nordic Packaging AB.`;
    const check1 = checkComposerText(firstOutput, m, 0);
    expect(check1.ok).toBe(false);
    if (check1.ok) return;
    expect(check1.reask?.suggestions[0]?.suggestedId).toBe(FIXTURE_IDS.meridian);

    // The model applies the suggestion.
    const secondOutput = firstOutput.replace(ghost, FIXTURE_IDS.meridian);
    const check2 = checkComposerText(secondOutput, m, 1);
    expect(check2.ok).toBe(true);

    const client: LinkerModelClient = {
      mode: "live",
      complete: async <T,>() => ({ text: "", json: { resolutions: [{ index: 0, entity_id: FIXTURE_IDS.saraLindqvist, confidence: 0.96 }] } as T }),
    };
    const linked = await linkComposerText(secondOutput, m, client, { businessId: "biz", attribution: { businessId: "biz" } });
    expect(linked.text).toBe(
      `[[ent:${FIXTURE_IDS.meridian}|Meridian Labs]] confirmed the quote; [[ent:${FIXTURE_IDS.saraLindqvist}|Sara]] will follow up with [[ent:${FIXTURE_IDS.nordicPackaging}|Nordic Packaging AB]].`,
    );
    expect(linked.entityIds).toEqual([FIXTURE_IDS.meridian, FIXTURE_IDS.saraLindqvist, FIXTURE_IDS.nordicPackaging]);
    expect(linked.tree.filter((n) => n.type === "entity")).toHaveLength(3);
    expect(linked.tree.every((n) => n.type !== "entity" || n.href?.startsWith("/b/biz/crm/"))).toBe(true);
    expect(validateMarkup(linked.text, m).valid).toBe(true);
  });

  it("falls back after the second failure so the note still ships without unknown ids", async () => {
    const ghost = uuidFor("ghost");
    const stillBad = `[[ent:${ghost}|Ghost Co]] replied to [[ent:${FIXTURE_IDS.meridian}|Meridian]].`;
    const check = checkComposerText(stillBad, m, 1);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reask).toBeNull();
    const linked = await linkComposerText(check.fallbackText, m);
    expect(linked.text).toBe(`Ghost Co replied to [[ent:${FIXTURE_IDS.meridian}|Meridian]].`);
    expect(linked.sweep.drafts.map((d) => d.name)).toEqual(["Ghost Co"]);
    expect(linked.entityIds).toEqual([FIXTURE_IDS.meridian]);
  });
});
