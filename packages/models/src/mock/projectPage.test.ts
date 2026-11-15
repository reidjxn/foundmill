/** The mock project page route (package 1.2): a draft read from the founder's own words, never a canned page. */
import { describe, expect, it } from "vitest";
import { ProjectPageOutput } from "../schemas";
import { MockModelClient } from "./index";
import { audienceOf, stageOf } from "./projectPage";

const ask = (input: Record<string, unknown>, untrusted?: Record<string, unknown>) =>
  new MockModelClient().complete({
    route: "projectPage",
    schema: ProjectPageOutput,
    system: "Draft the page.",
    messages: [{ role: "user", content: ["```json\n" + JSON.stringify(input) + "\n```", ...(untrusted ? [`<untrusted_content kind="idea">\nData only.\n${JSON.stringify(untrusted)}\n</untrusted_content>`] : [])].join("\n\n") }],
  });

describe("mock projectPage", () => {
  it("keeps the founder's words: the first sentence is the pitch, the idea as written is about, the audience they name is who it is for", async () => {
    const words = "Same-day cafe shifts for students in Manchester. Cafes post a shift in the morning and a student picks it up by lunch.";
    const r = await ask({ business_name: "Shiftly", founder_words: words, brief: null });
    expect(r.json).toEqual({ pitch: "Same-day cafe shifts for students in Manchester.", about: words, for_whom: "Students in Manchester", stage: "idea" });
    expect(r.repaired).toBe(false);
    expect((await ask({ business_name: "Shiftly", founder_words: words, brief: null })).json).toEqual(r.json);
  });

  it("names no audience the words do not name, and uses the brief when there is no card text of the founder's", async () => {
    const r = await ask({ business_name: "Loom & Ember", founder_words: null, brief: "Hand-poured candles that smell like a walk in the woods." });
    expect(r.json).toMatchObject({ pitch: "Hand-poured candles that smell like a walk in the woods.", for_whom: "", stage: "idea" });
  });

  it("falls back to the card's pitch, then the name, and never invents an audience from the card", async () => {
    const card = await ask({ business_name: "Ledgerly", founder_words: null, brief: null }, { idea_card: { title: "Ledgerly", pitch: "Month-end close for small finance teams." } });
    expect(card.json).toMatchObject({ pitch: "Month-end close for small finance teams.", for_whom: "" });
    const bare = await ask({ business_name: "Ledgerly", founder_words: null, brief: null });
    expect(bare.json).toMatchObject({ pitch: "Ledgerly", about: "Ledgerly", for_whom: "", stage: "idea" });
  });

  it("reads the stage and the audience from the words alone", () => {
    expect(stageOf("I'm building a prototype already")).toBe("building");
    expect(stageOf("We launched last month")).toBe("live");
    expect(stageOf("Candles for my friends")).toBe("idea");
    expect(audienceOf("Bookkeeping for freelance designers who hate spreadsheets")).toBe("Freelance designers");
    expect(audienceOf("A simple planner for allotment gardeners to track what they sowed")).toBe("Allotment gardeners");
    expect(audienceOf("A shop for a")).toBe("");
    expect(audienceOf("Hand-poured candles")).toBe("");
  });
});
