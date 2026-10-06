/**
 * AC-11.3.1: 100 consecutive generated notes have 100% valid entity links; no unknown ids reach render.
 * The generator stands in for the composer (mock side of "mock + live"); the live half runs in evals/.
 */
import { describe, expect, it } from "vitest";
import { entityIdsInTree, linkComposerText, parseEntityMarkup, serializeSegments, sweep, toRenderTree, validateMarkup } from "../index";
import { createRng, fixtureManifest, generateNote } from "../testing";

const m = fixtureManifest();

describe("AC-11.3.1 generated notes", () => {
  it("100 consecutive generated notes all validate, round-trip and render only manifest ids", async () => {
    const rng = createRng("ac-11.3.1");
    let mentions = 0;
    for (let i = 0; i < 100; i++) {
      const note = generateNote(m, rng, { plainNames: i % 3 === 0 });
      expect(note.wordCount, `note ${i} word count`).toBeGreaterThanOrEqual(60);
      expect(note.wordCount, `note ${i} word count`).toBeLessThanOrEqual(180);

      const v = validateMarkup(note.body_md, m);
      expect(v.valid, `note ${i}: ${JSON.stringify(v)}`).toBe(true);
      expect(v.entityIds.sort()).toEqual([...note.mentionIds].sort());
      mentions += v.mentionCount;

      expect(serializeSegments(parseEntityMarkup(note.body_md))).toBe(note.body_md);

      const linked = await linkComposerText(note.body_md, m);
      expect(validateMarkup(linked.text, m).valid).toBe(true);
      for (const id of entityIdsInTree(linked.tree)) expect(m.isVisible(id), `note ${i} rendered id ${id}`).toBe(true);
      for (const id of linked.entityIds) expect(m.isVisible(id)).toBe(true);
      // Every plain-text manifest name the generator wrote was picked up by the sweep (or is ambiguous, never dropped).
      for (const plain of note.plainMentions) {
        const found = linked.sweep.linked.some((l) => l.text === plain) || linked.sweep.ambiguous.some((a) => a.text === plain);
        expect(found, `note ${i}: "${plain}" not linked`).toBe(true);
      }
    }
    expect(mentions).toBeGreaterThan(100);
  });

  it("is deterministic for a given seed", () => {
    const a = generateNote(m, createRng("seed-7"));
    const b = generateNote(m, createRng("seed-7"));
    expect(a).toEqual(b);
  });

  it("rejects every corrupted note: unknown id, invisible entity, malformed markup", async () => {
    const rng = createRng("ac-11.3.1-corrupt");
    for (let i = 0; i < 30; i++) {
      const which = i % 3;
      const note = generateNote(m, rng, { corrupt: { unknownId: which === 0, invisible: which === 1, malformed: which === 2 } });
      const v = validateMarkup(note.body_md, m);
      expect(v.valid, `corrupt note ${i}`).toBe(false);
      if (which === 0) expect(v.unknownIds).toHaveLength(1);
      if (which === 1) expect(v.invisibleIds).toHaveLength(1);
      if (which === 2) expect(v.malformed).toHaveLength(1);
      // The render tree built from a validated manifest never carries the bad id.
      const tree = toRenderTree(note.body_md, m);
      for (const id of entityIdsInTree(tree)) expect(m.isVisible(id)).toBe(true);
      await expect(linkComposerText(note.body_md, m)).rejects.toThrow(/invalid entity markup/);
    }
  });

  it("the sweep drafts unknown names the generator planted, and links plain manifest names", async () => {
    const rng = createRng("drafts");
    const note = generateNote(m, rng, { plainNames: true, unknownNames: ["Helios Energy GmbH", "Priya Raman"] });
    const r = await sweep(note.body_md, m);
    expect(r.drafts.map((d) => d.name).sort()).toEqual(["Helios Energy GmbH", "Priya Raman"]);
    expect(r.drafts.find((d) => d.name === "Priya Raman")?.kindGuess).toBe("person");
    expect(validateMarkup(r.text, m).valid).toBe(true);
  });
});
