import { describe, expect, it } from "vitest";
import { FOUNDER_TASK_WORDS, founderAskMessage, founderTaskOf, type FounderTaskFacts } from "./founder-task";
import { pageAskText } from "./share-drafts";

const URL = "https://foundmill.test/p/northwood?via=p.northwood";
const fresh: FounderTaskFacts = { pagePublished: false, pageShared: false, planNoteOpen: true, outsideSignal: false, projectName: "Northwood", pitch: "Candles that smell like a walk in the woods", url: null, overnight: true };
const live: FounderTaskFacts = { ...fresh, pagePublished: true, url: URL };

describe("founderTaskOf", () => {
  it("goes publish, share, approve the plan, ask five, then nothing", () => {
    expect(founderTaskOf(fresh)?.id).toBe("publish_page");
    expect(founderTaskOf(live)?.id).toBe("share_page");
    expect(founderTaskOf({ ...live, pageShared: true })?.id).toBe("approve_plan");
    expect(founderTaskOf({ ...live, pageShared: true, planNoteOpen: false })?.id).toBe("ask_five");
    expect(founderTaskOf({ ...live, pageShared: true, planNoteOpen: false, outsideSignal: true })).toBeNull();
  });

  it("asks to publish again once the page is taken down, even after a share", () => {
    expect(founderTaskOf({ ...fresh, pageShared: true, planNoteOpen: false })?.id).toBe("publish_page");
  });

  it("says each task in the plan's words, with the page's own message to send", () => {
    const publish = founderTaskOf(fresh)!;
    expect([publish.title, publish.why, publish.action.kind]).toEqual(["Check your page and publish it", "It is the first thing of yours that people outside can see.", "open_page"]);
    const share = founderTaskOf(live)!;
    expect([share.title, share.why, share.action.kind]).toEqual(["Send your page to three people", "Ask if they would use it. What they say shapes what your team does next.", "share"]);
    expect(share.action.text).toBe(`I'm starting Northwood. Candles that smell like a walk in the woods. Would you use this?\n\n${URL}`);
    const plan = founderTaskOf({ ...live, pageShared: true })!;
    expect([plan.title, plan.why, plan.action.kind]).toEqual(["Read your plan and approve it", "Five lines. Your team starts building when you do.", "open_note"]);
    const ask = founderTaskOf({ ...live, pageShared: true, planNoteOpen: false })!;
    expect([ask.title, ask.action.kind]).toEqual(["Ask five people the question on your page", "copy"]);
    expect(ask.action.text).toBe(share.action.text);
  });

  it("says what tomorrow brings by whether the overnight shift is on", () => {
    expect(founderTaskOf(fresh)!.tomorrow).toBe("Tomorrow morning: what your team found overnight, and one thing to do.");
    expect(founderTaskOf({ ...fresh, overnight: false })!.tomorrow).toBe("Come back when you have heard from someone, or press Continue for a round of work.");
  });

  it("one a day: after a task done today it names the next one for tomorrow", () => {
    expect(founderTaskOf(live)!.doneToday).toBe(false);
    const next = founderTaskOf({ ...live, doneToday: ["publish_page"] })!;
    expect([next.id, next.doneToday]).toEqual(["share_page", true]);
    expect(FOUNDER_TASK_WORDS.doneToday).toBe("Done for today.");
  });

  it("never names a cofounder, a job or a football word", () => {
    const all = [fresh, live, { ...live, pageShared: true }, { ...live, pageShared: true, planNoteOpen: false }].map((f) => JSON.stringify(founderTaskOf(f)));
    for (const text of [...all, JSON.stringify(FOUNDER_TASK_WORDS)]) expect(text).not.toMatch(/cofounder|co-founder|job|career|employ|squad|club|match/i);
  });
});

describe("founderAskMessage", () => {
  it("is the public page's ask, with the address after a blank line", () => {
    expect(founderAskMessage({ projectName: "Northwood", pitch: null, url: URL })).toBe(`${pageAskText("Northwood", null)}\n\n${URL}`);
    expect(pageAskText("Northwood", "Northwood")).toBe("I'm starting Northwood. Would you use this?");
    expect(founderAskMessage({ projectName: "Northwood", pitch: "Candles!", url: null })).toBe("I'm starting Northwood. Candles! Would you use this?");
  });
});
