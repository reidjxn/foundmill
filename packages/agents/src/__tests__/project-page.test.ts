/**
 * The team's first draft of a project's public page (docs/THESIS_REVIEW.md package 1.2): the request keeps the founder's
 * words trusted and the card untrusted, sends no founder profile; the answer is held to the shared page schema and
 * never invents a figure; any failure falls back to the starter draft; the note asks without holding Continue.
 */
import { MockModelClient, ModelUnavailableError, ProjectPageOutput } from "@foundmill/models";
import { PAGE_READY_NOTE, starterPageDraft } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { draftProjectPage, runProjectPageStep, type ProjectPageStore } from "../foundations-steps";
import { PROJECT_PAGE_ROUTE, buildProjectPageRequest, finaliseProjectPage, inventedFigures, projectPageReadyNote, starterProjectPage } from "../project-page";
import { projectPagePrompt } from "../prompts/project-page";
import { getTemplate } from "../registry";
import { agentParts, expectFollowsAgent } from "./agent-parts.fixtures";
import { ideationInputs } from "./foundations.fixtures";

describe("buildProjectPageRequest follows the business's Product lead (WP-06 T1)", () => {
  it("with `agent`, its instructions and skills; without, the template as before", () => {
    const template = getTemplate("product_lead");
    const inputs = ideationInputs();
    const withAgent = buildProjectPageRequest({ ...inputs, agent: agentParts(template) }).system[0]!;
    expectFollowsAgent(withAgent, buildProjectPageRequest(inputs).system[0]!, template, inputs.businessName);
  });
});

const WORDS = "Same-day cafe shifts for students in Manchester. Cafes post a shift in the morning and a student picks it up by lunch.";
const withWords = () => {
  const inputs = ideationInputs();
  inputs.idea!.founderWords = WORDS;
  return inputs;
};

describe("buildProjectPageRequest", () => {
  it("house rules and the Product lead first, then the page prompt; the founder's words trusted, the card untrusted, no profile", () => {
    const req = buildProjectPageRequest(withWords());
    expect(req.route).toBe(PROJECT_PAGE_ROUTE);
    expect(req.schema).toBe(ProjectPageOutput);
    expect(req.system).toHaveLength(2);
    expect(req.system[0]).toContain("## House rules");
    expect(req.system[1]).toBe(projectPagePrompt.render({ business_name: "Ledgerly" }));
    const user = req.messages[0]!.content;
    const [trusted] = user.split("<untrusted_content");
    expect(trusted).toContain(JSON.stringify(WORDS).slice(1, 30));
    expect(trusted).toContain("bookkeeping for independent accountants in the Nordics");
    expect(trusted).not.toContain("narrow, opinionated workflow");
    expect(user).toMatch(/<untrusted_content kind="idea">[\s\S]*narrow, opinionated workflow[\s\S]*<\/untrusted_content>/);
    // The founder profile (budget, residence, skills) never reaches the page.
    expect(user).not.toMatch(/budget|residence|first-time|bootstrapped/);
  });

  it("the prompt holds the rules: the founder's words, invent nothing, no superlatives, an audience only when named, stage idea", () => {
    const text = projectPagePrompt.text;
    expect(text).toMatch(/Keep the founder's own words/);
    expect(text).toMatch(/Never invent anything: no customers/);
    expect(text).toMatch(/No superlatives/);
    expect(text).toMatch(/only when the inputs name an audience/);
    expect(text).toMatch(/"idea", unless/);
    expect(text).toMatch(/US English/);
  });
});

describe("finaliseProjectPage", () => {
  it("never carries a price, an offer, a button or an ask switch, whatever the model sends (WP-08 T6)", () => {
    const ok = { pitch: "Same-day cafe shifts for students", about: WORDS, for_whom: "Students in Manchester", stage: "idea" };
    const out = finaliseProjectPage({ ...ok, price: "$9", offer: "Free coffee", cta: { label: "Buy", url: "https://buy.stripe.com/x" }, askForm: true }, withWords());
    if ("draft" in out) for (const key of ["price", "offer", "cta", "askForm"]) expect(out.draft, key).not.toHaveProperty(key);
    else expect(out.refused).toBeTruthy();
  });

  const ok = { pitch: "Same-day cafe shifts for students in Manchester.", about: WORDS, for_whom: "Students in Manchester", stage: "idea" as const };

  it("takes a plain answer within the limits, never naming the founders", () => {
    expect(finaliseProjectPage(ok, withWords())).toEqual({ draft: { pitch: ok.pitch, about: WORDS, forWhom: "Students in Manchester", stage: "idea", showFounders: false, followForm: true } });
  });

  it("refuses links, addresses and markup, an answer outside the limits, and any figure the inputs did not give", () => {
    expect(finaliseProjectPage({ ...ok, about: `${WORDS} See https://shiftly.example` }, withWords())).toEqual({ refused: "markup" });
    expect(finaliseProjectPage({ ...ok, about: `${WORDS} Write to hi@shiftly.example.` }, withWords())).toEqual({ refused: "markup" });
    expect(finaliseProjectPage({ ...ok, pitch: "x".repeat(141) }, withWords())).toEqual({ refused: "limits" });
    expect(finaliseProjectPage({ ...ok, about: "   " }, withWords())).toEqual({ refused: "limits" });
    expect(finaliseProjectPage({ ...ok, about: `${WORDS} Already used by 200 cafes.` }, withWords())).toEqual({ refused: "invented_figure" });
    expect(inventedFigures({ pitch: "From £5 a shift", about: "", forWhom: "" }, withWords())).toEqual(["5"]);
    // A figure only the Ideation agent's card carries is not the founder's: it counts as invented.
    const card = withWords();
    card.idea!.pitch = "Used by 500 cafes.";
    expect(inventedFigures({ pitch: "Used by 500 cafes", about: "", forWhom: "" }, card)).toEqual(["500"]);
    const inputs = withWords();
    inputs.idea!.founderWords = "Shifts from £5, in 3 cafes so far.";
    expect(inventedFigures({ pitch: "Shifts from £5", about: "Live in 3 cafes.", forWhom: "" }, inputs)).toEqual([]);
  });
});

describe("draftProjectPage", () => {
  it("in mock mode the draft is the founder's own words", async () => {
    const drafted = await draftProjectPage({ models: new MockModelClient(), inputs: withWords() });
    expect(drafted).toMatchObject({ source: "model", reason: null, draft: { pitch: "Same-day cafe shifts for students in Manchester.", about: WORDS, forWhom: "Students in Manchester", stage: "idea", showFounders: false } });
    expect(drafted.usage.calls).toBe(1);
  });

  it("a failed call (an outage, used-up credits) falls back to the starter draft, silently", async () => {
    const drafted = await draftProjectPage({ models: new MockModelClient({ failWith: { projectPage: new ModelUnavailableError("upstream 529") } }), inputs: withWords() });
    expect(drafted).toMatchObject({ source: "starter", reason: "unavailable" });
    expect(drafted.draft).toEqual(starterPageDraft({ businessName: "Ledgerly", founderWords: WORDS }));
    expect(drafted.draft).toEqual(starterProjectPage(withWords()));
  });

  it("an aborted run is not hidden behind the starter", async () => {
    const stop = new AbortController();
    stop.abort();
    await expect(draftProjectPage({ models: new MockModelClient(), inputs: withWords(), signal: stop.signal })).rejects.toThrow();
  });
});

describe("runProjectPageStep", () => {
  const store = (needed: boolean) => {
    const writes: Parameters<ProjectPageStore["write"]>[0][] = [];
    const s: ProjectPageStore = { needed: async () => needed, write: async (w) => (writes.push(w), { written: true, inboxItemId: "33333333-3333-4333-8333-333333333333" }) };
    return { s, writes };
  };

  it("asks the model only when the page needs a draft, and writes it with the Product lead's note", async () => {
    const models = new MockModelClient();
    const skip = store(false);
    expect(await runProjectPageStep({ models, inputs: withWords() }, skip.s)).toMatchObject({ written: false, source: null });
    expect(models.history).toHaveLength(0);
    const go = store(true);
    expect(await runProjectPageStep({ models, inputs: withWords() }, go.s)).toMatchObject({ written: true, source: "model", inboxItemId: "33333333-3333-4333-8333-333333333333" });
    expect(go.writes[0]!.note).toEqual(projectPageReadyNote());
  });
});

describe("projectPageReadyNote", () => {
  it("one line on what the page is; Check it and publish (recommended) or Later; nothing implies anyone else is needed", () => {
    const note = projectPageReadyNote();
    expect(note.subject).toBe("Your project's page is ready");
    expect(note.bodyMd).toBe("I drafted a public page for your project from your own words: one line on what it is, a few lines about it and who it is for. Nothing is public until you publish it, and then it has its own Foundmill address you can send to anyone.");
    expect(note.options.map((o) => [o.id, o.label, o.recommended])).toEqual([
      [PAGE_READY_NOTE.options.check, "Check it and publish", true],
      [PAGE_READY_NOTE.options.later, "Later", false],
    ]);
    expect(JSON.stringify(note)).not.toMatch(/cofounder|co-founder|staff|seat|job|career|employ/i);
  });
});
