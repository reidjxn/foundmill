/**
 * The showcase script's code check (docs/THESIS_REVIEW.md §13 item 15): every answer of the house social agent passes
 * it before it is stored. It refuses a digit outside a date, a fact not in the input, counts, rankings or recency,
 * words of lack, anything about people, work framing and banned terms; an adversarial answer is dropped after one retry.
 */
import { createModelClient } from "@foundmill/models";
import { describe, expect, it } from "vitest";
import { buildShowcaseScriptRequest, checkShowcaseScript, finaliseShowcaseScript, runShowcaseScriptStep, showcaseScriptFacts, type ShowcaseScriptFacts } from "../showcase-script";
import { showcaseScriptPrompt } from "../prompts/showcase-script";

const PAGE = "11111111-1111-4111-8111-111111111111";
const FOLLOWER = "22222222-2222-4222-8222-222222222222";
const facts: ShowcaseScriptFacts = showcaseScriptFacts({
  name: "Maple Bakes",
  milestones: [
    { id: FOLLOWER, key: "first_follower", label: "First follower", achievedAt: new Date("2026-11-14T10:00:00Z") },
    { id: PAGE, key: "page_live", label: "Page live", achievedAt: new Date("2026-11-12T15:00:00Z") },
  ],
});
const shots = [
  { card: "c1", caption: "Nov 12: page live" },
  { card: "c2", caption: "Nov 14: first follower" },
];
const good = { shots, post: "How Maple Bakes was built. Page live on Nov 12, 2026. First follower on Nov 14, 2026." };
const post = (text: string) => checkShowcaseScript({ shots, post: text }, facts);

describe("showcaseScriptFacts", () => {
  it("carries only the name and the cards, oldest first, at most three, with both forms of each date", () => {
    expect(Object.keys(facts).sort()).toEqual(["cards", "maxChars", "projectName"]);
    expect(facts.cards.map((c) => [c.card, c.key, c.on, c.onShort])).toEqual([
      ["c1", "page_live", "Nov 12, 2026", "Nov 12"],
      ["c2", "first_follower", "Nov 14, 2026", "Nov 14"],
    ]);
    const four = showcaseScriptFacts({ name: "X Project", milestones: [1, 2, 3, 4].map((d) => ({ id: `${d}`, key: "page_live" as const, label: "Page live", achievedAt: new Date(`2026-11-0${d}T00:00:00Z`) })) });
    expect(four.cards.map((c) => c.milestoneId)).toEqual(["2", "3", "4"]);
  });

  it("the request names no person and no count of people: only the trusted JSON of the story", () => {
    const req = buildShowcaseScriptRequest(facts);
    const user = req.messages[0]!.content;
    expect(user).toContain('"project_name":"Maple Bakes"');
    expect(user).not.toMatch(/founder|owner|member|cofounder/i);
    expect(req.route).toBe(showcaseScriptPrompt.route);
  });
});

describe("checkShowcaseScript", () => {
  it("passes a script made of the facts", () => {
    expect(checkShowcaseScript(good, facts)).toBeNull();
    expect(post("Maple Bakes went live on Nov 12, 2026.")).toBeNull();
  });

  it("refuses a digit outside a date", () => {
    expect(post("Maple Bakes went live on Nov 12, 2026 with 40 loaves.")).toBe("digit");
    expect(checkShowcaseScript({ shots: [{ card: "c1", caption: "Nov 12: page live, 3 pm" }], post: good.post }, facts)).toBe("digit");
  });

  it("refuses a fact not in the input", () => {
    expect(post("Maple Bakes sold out its sourdough after its page went live on Nov 12, 2026.")).toBe("unknown_fact");
    expect(post("Maple Bakes went live on Nov 12, 2026 and has customers.")).toBe("unknown_fact");
    expect(post("Maple Bakes went live on Dec 1, 2026.")).toBe("digit");
    expect(post("Maple Bakes went live in Leeds on Nov 12, 2026.")).toBe("unknown_fact");
    expect(checkShowcaseScript({ shots: [{ card: "c1", caption: "Nov 14: page live" }], post: good.post }, facts)).toBe("unknown_fact");
    expect(checkShowcaseScript({ shots: [{ card: "c1", caption: "Nov 12: first customer" }], post: good.post }, facts)).toBe("unknown_fact");
  });

  it("refuses counts, rankings and recency", () => {
    for (const p of ["Maple Bakes is the top bakery on Nov 12, 2026.", "Maple Bakes was the first to go live on Nov 12, 2026.", "Maple Bakes went live this week.", "Maple Bakes just went live on Nov 12, 2026.", "Maple Bakes has two milestones."]) expect(post(p), p).toBe("ranking");
  });

  it("refuses words of lack and anything about people", () => {
    for (const p of ["Maple Bakes was built alone. Page live on Nov 12, 2026.", "A solo build: page live on Nov 12, 2026.", "Maple Bakes went live on Nov 12, 2026 without a cofounder.", "Just one person built Maple Bakes. Page live on Nov 12, 2026."]) expect(post(p), p).toBe("lack");
    for (const p of ["Its founders put Maple Bakes live on Nov 12, 2026.", "She put Maple Bakes live on Nov 12, 2026.", "A team of agents built Maple Bakes. Page live on Nov 12, 2026."]) expect(post(p), p).toBe("people");
  });

  it("refuses work framing and banned terms", () => {
    expect(post("Maple Bakes went live on Nov 12, 2026 instead of a job.")).toBe("work");
    expect(post("Maple Bakes is a way out of the job market. Page live on Nov 12, 2026.")).toBe("work");
    expect(post("The Maple Bakes squad went live on Nov 12, 2026.")).toBe("banned");
  });

  it("refuses links, hashtags, emoji, exclamation marks and markup", () => {
    for (const p of ["Maple Bakes went live on Nov 12, 2026: maplebakes.com", "Maple Bakes went live on Nov 12, 2026 #bread", "Maple Bakes went live on Nov 12, 2026!", "**Maple Bakes** went live on Nov 12, 2026."]) expect(post(p), p).toBe("markup");
  });

  it("refuses an unknown or repeated card, too many shots and a long caption", () => {
    expect(checkShowcaseScript({ shots: [{ card: "c9", caption: "Nov 12: page live" }], post: good.post }, facts)).toBe("unknown_card");
    expect(checkShowcaseScript({ shots: [shots[0]!, shots[0]!], post: good.post }, facts)).toBe("unknown_card");
    expect(checkShowcaseScript({ shots: [{ card: "c1", caption: "Nov 12: page live, and the story of the page is a long one" }], post: good.post }, facts)).toBe("too_long");
  });
});

describe("finaliseShowcaseScript and the step", () => {
  it("maps the cards to their milestones in date order", () => {
    const fin = finaliseShowcaseScript({ shots: [shots[1], shots[0]], post: good.post }, facts);
    expect(fin).toEqual({ shots: [{ milestoneId: PAGE, caption: "Nov 12: page live" }, { milestoneId: FOLLOWER, caption: "Nov 14: first follower" }], postText: good.post });
  });

  it("the mock route writes a script that passes", async () => {
    const client = createModelClient({ mode: "mock", logger: { debug() {}, info() {}, warn() {}, error() {} } });
    const out = await runShowcaseScriptStep({ models: client, facts });
    expect(out.outcome).toBe("written");
    if (out.outcome === "written") expect(out.script.shots.map((s) => s.milestoneId)).toEqual([PAGE, FOLLOWER]);
  });

  it("drops an adversarial answer after one retry with the reason, and stores nothing", async () => {
    const calls: string[] = [];
    const models = {
      complete: async (req: { messages: { content: string }[] }) => {
        calls.push(req.messages[0]!.content);
        return { json: { shots, post: "Built alone by one founder in a week, instead of a job: the top bakery, 500 customers!" }, cost: { costMinorInt: 1 }, model: "m", mode: "mock" } as never;
      },
    };
    const out = await runShowcaseScriptStep({ models: models as never, facts });
    expect(out).toMatchObject({ outcome: "dropped", usage: { calls: 2 } });
    expect(calls[1]).toMatch(/Your last script was not used/);
  });
});
