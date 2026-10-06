import { describe, expect, it } from "vitest";
import { entityIdsInTree, renderTreeToPlain, sweep, toRenderTree } from "../index";
import { FIXTURE_IDS, fixtureManifest, uuidFor } from "../testing";

const m = fixtureManifest();
const MER = FIXTURE_IDS.meridian;

describe("toRenderTree", () => {
  it("turns validated markup into text and entity nodes with kind, name and href", () => {
    const tree = toRenderTree(`Hi [[ent:${MER}|Meridian]].`, m, { businessId: "biz" });
    expect(tree).toEqual([
      { type: "text", text: "Hi " },
      { type: "entity", id: MER, display: "Meridian", kind: "organisation", name: "Meridian Labs", href: `/b/biz/crm/${MER}/overview` },
      { type: "text", text: "." },
    ]);
    expect(entityIdsInTree(tree)).toEqual([MER]);
    expect(renderTreeToPlain(tree)).toBe("Hi Meridian.");
  });

  it("supports a custom href builder and no href at all", () => {
    expect(toRenderTree(`[[ent:${MER}|M]]`, m, { hrefFor: (id) => `#${id}` })[0]).toMatchObject({ href: `#${MER}` });
    expect(toRenderTree(`[[ent:${MER}|M]]`, m)[0]).not.toHaveProperty("href");
  });

  it("never emits an entity node for an unknown or invisible id when a manifest is given", () => {
    const ghost = uuidFor("ghost");
    const tree = toRenderTree(`[[ent:${ghost}|Ghost]] and [[ent:${FIXTURE_IDS.hiddenInvestor}|Hidden Investor]] and [[ent:${MER}|Meridian]]`, m);
    expect(tree).toEqual([
      { type: "text", text: "Ghost and Hidden Investor and " },
      { type: "entity", id: MER, display: "Meridian", kind: "organisation", name: "Meridian Labs" },
    ]);
  });

  it("renders sweep output: ambiguous → dotted underline + Which one?, draft → unverified", async () => {
    const r = await sweep("Sara met Acme Robotics Inc. at Meridian.", m);
    const tree = toRenderTree(r.segments, m);
    expect(tree[0]).toMatchObject({ type: "ambiguous", text: "Sara", prompt: "Which one?", decoration: "dotted-underline" });
    expect(tree[0]?.type === "ambiguous" ? tree[0].candidates : []).toHaveLength(2);
    expect(tree[2]).toEqual({ type: "draft", name: "Acme Robotics Inc.", kindGuess: "organisation", flag: "unverified" });
    expect(tree[4]).toMatchObject({ type: "entity", id: MER, display: "Meridian" });
    expect(renderTreeToPlain(tree)).toBe("Sara met Acme Robotics Inc. at Meridian.");
    expect(toRenderTree(r.segments, m, { ambiguousPrompt: "Vem?" })[0]).toMatchObject({ prompt: "Vem?" });
  });

  it("merges adjacent text and works without a manifest", () => {
    expect(toRenderTree([{ kind: "text", text: "a" }, { kind: "text", text: "b" }, { kind: "entity", id: MER, display: "M" }])).toEqual([
      { type: "text", text: "ab" },
      { type: "entity", id: MER, display: "M" },
    ]);
  });
});
