import { describe, expect, it } from "vitest";
import {
  PAGE_ABOUT_MAX,
  PAGE_HOLD_MESSAGES,
  PAGE_HOLD_REASONS,
  PAGE_PITCH_MAX,
  PAGE_RESERVED_SLUGS,
  PAGE_SLUG_MAX,
  PAGE_STAGE_LABELS,
  builtByLine,
  builtOnWords,
  clipText,
  firstSentence,
  isPageSlug,
  isPublishablePage,
  pageContentProblems,
  pageDescription,
  pageParagraphs,
  pagePath,
  pageSlugProblem,
  pageStateLine,
  pageTitle,
  pageUrl,
  readPageContent,
  samePageContent,
  starterPageDraft,
  PAGE_READY_NOTE,
  isPageReadyDecision,
  suffixPageSlug,
  suggestPageSlug,
  FOLLOW_ERRORS,
  FOLLOW_SOURCE_LABEL,
  followConsentLine,
  followerDisplayName,
  FOLLOW_CONFIRM_EMAIL,
  FOLLOW_CONFIRM_PAGE,
  FOLLOW_EMAIL_MAX,
  FOLLOW_PENDING_LINE,
  followConsentText,
  followEmailProblem,
  followWords,
  followerCountLine,
  type ProjectPageContent,
} from "./project-page";
import { ProjectPageContent as ContentSchema, ProjectPageDraft, ProjectPageSlug } from "./types";

const page = (over: Partial<ProjectPageContent> = {}): ProjectPageContent => ({ pitch: "Hand-poured candles that smell like a walk in the woods", about: "We make small batches.\n\nEvery candle is poured by hand.", forWhom: "", stage: "idea", showFounders: false, followForm: true, ...over });

describe("page slugs", () => {
  it("accepts 3 to 40 lowercase letters, digits and hyphens that start and end with a letter or digit", () => {
    for (const ok of ["abc", "north-wind", "a1b", "x".repeat(40), "2026-candles"]) expect(pageSlugProblem(ok), ok).toBeNull();
    for (const bad of ["ab", "x".repeat(41), "-abc", "abc-", "Abc", "a_b", "a b", "a.b", "é-candles", ""]) expect(pageSlugProblem(bad), bad).toBeTruthy();
  });

  it("refuses every address the product keeps", () => {
    for (const reserved of ["new", "login", "api", "p", "b", "admin", "settings", "foundmill", "www", "app", "help", "about", "terms", "privacy", "auth", "start", "examples", "businesses", "onboarding"]) {
      expect(PAGE_RESERVED_SLUGS).toContain(reserved);
      expect(isPageSlug(reserved), reserved).toBe(false);
    }
  });

  it("suggests a slug that always passes, from any text", () => {
    expect(suggestPageSlug("northwind-skincare")).toBe("northwind-skincare");
    expect(suggestPageSlug("Café Olé!")).toBe("cafe-ole");
    expect(suggestPageSlug("ab")).toBe("ab-project");
    expect(suggestPageSlug("")).toBe("project");
    expect(suggestPageSlug("app")).toBe("app-project");
    expect(suggestPageSlug("a--b--c")).toBe("a-b-c");
    const long = suggestPageSlug("the quick brown fox jumps over the lazy dog again and again");
    expect(long.length).toBeLessThanOrEqual(PAGE_SLUG_MAX);
    for (const text of ["northwind-skincare", "Café Olé!", "ab", "", "app", "---", long, "x".repeat(80)]) expect(pageSlugProblem(suggestPageSlug(text)), text).toBeNull();
  });

  it("adds a suffix inside the limit", () => {
    expect(suffixPageSlug("northwind", "0f0a0d00")).toBe("northwind-0f0a0d00");
    const s = suffixPageSlug("x".repeat(40), "ab12");
    expect(s).toHaveLength(40);
    expect(pageSlugProblem(s)).toBeNull();
  });

  it("builds the address under /p/", () => {
    expect(pagePath("north-wind")).toBe("/p/north-wind");
    expect(pageUrl("https://foundmill.example/", "north-wind")).toBe("https://foundmill.example/p/north-wind");
  });

  it("the Zod slug says the same thing", () => {
    expect(ProjectPageSlug.safeParse(" north-wind ").data).toBe("north-wind");
    expect(ProjectPageSlug.safeParse("login").success).toBe(false);
    expect(ProjectPageSlug.safeParse("ab").success).toBe(false);
  });
});

describe("page content", () => {
  it("splits paragraphs on blank lines and keeps single breaks inside one", () => {
    expect(pageParagraphs("One.\r\n\r\n\r\nTwo\nstill two.  \n\n  Three.")).toEqual(["One.", "Two\nstill two.", "Three."]);
    expect(pageParagraphs("   ")).toEqual([]);
  });

  it("says what stops a page from going out, by field", () => {
    expect(pageContentProblems(page())).toEqual({});
    expect(isPublishablePage(page())).toBe(true);
    expect(pageContentProblems(page({ pitch: "  ", about: "" }))).toEqual({ pitch: "Say what it is in one line.", about: "Say a little about the project." });
    expect(pageContentProblems(page({ pitch: "x".repeat(PAGE_PITCH_MAX + 1) })).pitch).toBe("Keep the one-line pitch to 140 characters.");
    expect(pageContentProblems(page({ about: "x".repeat(PAGE_ABOUT_MAX + 1) })).about).toBe("Keep this to 1,500 characters.");
    expect(pageContentProblems(page({ forWhom: "x".repeat(301) })).forWhom).toBe("Keep this to 300 characters.");
  });

  it("the schema tidies first, then applies the limits; a draft may still be empty", () => {
    const parsed = ContentSchema.parse({ pitch: "  Candles\n that  last ", about: "One.\r\n\r\n\r\nTwo.", forWhom: " People who like candles ", stage: "building" });
    expect(parsed).toEqual({ pitch: "Candles that last", about: "One.\n\nTwo.", forWhom: "People who like candles", stage: "building", showFounders: false, followForm: true });
    expect(ContentSchema.safeParse(page({ pitch: "" })).success).toBe(false);
    expect(ContentSchema.safeParse(page({ about: "   " })).success).toBe(false);
    expect(ContentSchema.safeParse(page({ pitch: "x".repeat(141) })).success).toBe(false);
    expect(ContentSchema.safeParse(page({ pitch: "x".repeat(140) })).success).toBe(true);
    expect(ContentSchema.safeParse({ ...page(), stage: "launched" }).success).toBe(false);
    expect(ProjectPageDraft.safeParse(page({ pitch: "", about: "" })).success).toBe(true);
    expect(ProjectPageDraft.safeParse(page({ about: "x".repeat(1501) })).success).toBe(false);
  });

  it("compares a draft with what is published after tidying", () => {
    expect(samePageContent(page(), page({ about: "We make small batches.\r\n\r\n\r\nEvery candle is poured by hand.  " }))).toBe(true);
    expect(samePageContent(page(), page({ stage: "live" }))).toBe(false);
    expect(samePageContent(page(), page({ showFounders: true }))).toBe(false);
  });

  it("reads a stored value defensively", () => {
    expect(readPageContent(null)).toBeNull();
    expect(readPageContent([])).toBeNull();
    expect(readPageContent({ pitch: 1, about: "x" })).toBeNull();
    expect(readPageContent({ pitch: "a", about: "b", stage: "nope", showFounders: "yes" })).toEqual({ pitch: "a", about: "b", forWhom: "", stage: "idea", showFounders: false, followForm: false });
  });

  it("the follow form: on for new pages; a copy stored before it existed reads as off when published, on as a draft", () => {
    expect(ContentSchema.parse({ pitch: "a", about: "b" }).followForm).toBe(true);
    expect(ContentSchema.parse({ pitch: "a", about: "b", followForm: false }).followForm).toBe(false);
    const old = { pitch: "a", about: "b", forWhom: "", stage: "idea", showFounders: false };
    expect(readPageContent(old)!.followForm).toBe(false);
    expect(readPageContent(old, true)!.followForm).toBe(true);
    expect(readPageContent({ ...old, followForm: false }, true)!.followForm).toBe(false);
    expect(samePageContent(page(), page({ followForm: false }))).toBe(false);
  });
});

describe("following a project", () => {
  it("says it in the project's name, in plain words", () => {
    const w = followWords("Northwind  Skincare");
    expect(w.heading).toBe("Follow Northwind Skincare");
    expect(w.line).toBe("Leave your email and Northwind Skincare will let you know when there is news.");
    expect(w.consent).toBe("I agree to get email from Northwind Skincare about this project. I can unsubscribe at any time.");
    expect(w.consent).toBe(followConsentText("Northwind Skincare"));
    expect(w.button).toBe("Follow");
    expect(w.done).toBe("Check your email to confirm. Northwind Skincare will only write to you after you do.");
  });

  it("checks an address before it is sent", () => {
    for (const ok of ["maya@example.com", " Maya.Lee+news@sub.example.co.uk "]) expect(followEmailProblem(ok)).toBeNull();
    for (const bad of ["", "maya", "maya@", "@example.com", "maya@example", "ma ya@example.com", "<a>@x.com", `${"a".repeat(250)}@x.com`]) expect(followEmailProblem(bad)).toBe(FOLLOW_ERRORS.email);
    // At most 200 characters, the CRM's name limit: 200 passes, 201 is the same plain refusal.
    const at200 = `${"a".repeat(200 - "@example.com".length)}@example.com`;
    expect(at200).toHaveLength(FOLLOW_EMAIL_MAX);
    expect(followEmailProblem(at200)).toBeNull();
    expect(followEmailProblem(`a${at200}`)).toBe(FOLLOW_ERRORS.email);
  });

  it("names a new follower without their whole address", () => {
    expect(followerDisplayName("Maya.Lee@Example.com")).toBe("Follower (ma***@example.com)");
    expect(followerDisplayName("al@example.com")).toBe("Follower (a***@example.com)");
    expect(followerDisplayName("x@example.com")).toBe("Follower (x***@example.com)");
    expect(followerDisplayName("maya.lee@example.com")).not.toContain("maya.lee");
    const long = followerDisplayName(`abc@${"d".repeat(190)}.example.com`);
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.startsWith("Follower (ab***@")).toBe(true);
  });

  it("asks the person to confirm in one email, and says so on the page its link opens", () => {
    expect(FOLLOW_CONFIRM_EMAIL.subject("Northwind  Skincare")).toBe("Confirm that you want to follow Northwind Skincare");
    expect(FOLLOW_CONFIRM_EMAIL.text("Northwind Skincare", "Foundmill", "https://ingest.example/mail/confirm?t=x")).toBe(
      "Someone, hopefully you, asked to follow Northwind Skincare on Foundmill with this address. Confirm to get email from Northwind Skincare about this project:\n\nhttps://ingest.example/mail/confirm?t=x\n\nIf it was not you, ignore this email and nothing will happen.",
    );
    expect(FOLLOW_CONFIRM_PAGE.done("Northwind Skincare")).toBe("You're following Northwind Skincare. You can unsubscribe from any email it sends.");
    expect(FOLLOW_PENDING_LINE).toBe("Not confirmed yet");
  });

  it("counts followers for the founder only once there is one", () => {
    expect(followerCountLine(0)).toBeNull();
    expect(followerCountLine(1)).toBe("1 person follows this project");
    expect(followerCountLine(1200)).toBe("1,200 people follow this project");
    expect(followConsentLine("Oct 7, 2026")).toBe("Agreed to email on Oct 7, 2026");
    expect(FOLLOW_SOURCE_LABEL).toBe("Public page");
  });
});

describe("the starter draft", () => {
  it("takes the pitch from the founder's own first sentence and the rest from the vision", () => {
    const draft = starterPageDraft({ businessName: "Northwind", founderWords: "Candles that smell like a forest walk. I want to sell them online.", visionStatement: "Bring the outdoors inside.", visionForWhom: "People in small city apartments" });
    expect(draft).toEqual({ pitch: "Candles that smell like a forest walk.", about: "Bring the outdoors inside.", forWhom: "People in small city apartments", stage: "idea", showFounders: false, followForm: true });
  });

  it("before a vision exists, about is the founder's own words (the team's fallback draft, package 1.2)", () => {
    const words = "Same-day cafe shifts for students in Manchester.\n\nCafes post a shift in the morning.";
    expect(starterPageDraft({ businessName: "Shiftly", founderWords: words })).toEqual({ pitch: "Same-day cafe shifts for students in Manchester.", about: words, forWhom: "", stage: "idea", showFounders: false, followForm: true });
  });

  it("marks the page note by its decision key only", () => {
    expect(isPageReadyDecision({ key: PAGE_READY_NOTE.key, options: [] })).toBe(true);
    expect(isPageReadyDecision({ key: "goal" })).toBe(false);
    expect(isPageReadyDecision(null)).toBe(false);
    expect(PAGE_READY_NOTE.subject).toBe("Your project's page is ready");
  });

  it("falls back to the project's name and leaves the rest for the founder", () => {
    expect(starterPageDraft({ businessName: "  Northwind   Skincare " })).toEqual({ pitch: "Northwind Skincare", about: "", forWhom: "", stage: "idea", showFounders: false, followForm: true });
  });

  it("never exceeds the limits", () => {
    const draft = starterPageDraft({ businessName: "N", founderWords: "word ".repeat(100), visionStatement: "long ".repeat(600), visionForWhom: "who ".repeat(200) });
    expect(draft.pitch.length).toBeLessThanOrEqual(140);
    expect(draft.about.length).toBeLessThanOrEqual(1500);
    expect(draft.forWhom.length).toBeLessThanOrEqual(300);
    expect(draft.pitch.endsWith("…")).toBe(true);
  });
});

describe("the page's words", () => {
  it("names one person or several, never a count", () => {
    expect(builtByLine(["Maya"])).toBe("Built by Maya");
    expect(builtByLine(["Maya", "Sam"])).toBe("Built by Maya and Sam");
    expect(builtByLine(["Maya", "Sam", "Lee"])).toBe("Built by Maya, Sam and Lee");
    expect(builtByLine([])).toBeNull();
    expect(builtByLine(null)).toBeNull();
    expect(builtByLine(["  "])).toBeNull();
  });

  it("writes the title and the description for search and share cards", () => {
    expect(pageTitle("Northwind", "Candles that last")).toBe("Northwind: Candles that last");
    expect(pageTitle("Northwind", "northwind")).toBe("Northwind");
    expect(pageTitle("Northwind", "x ".repeat(80)).length).toBeLessThanOrEqual(70);
    expect(pageDescription("One.\n\nTwo.", "fallback")).toBe("One. Two.");
    expect(pageDescription("", "fallback")).toBe("fallback");
    expect(pageDescription("word ".repeat(100), "").length).toBeLessThanOrEqual(160);
  });

  it("cuts at a word and finds the first sentence", () => {
    expect(clipText("short", 10)).toBe("short");
    expect(clipText("one two three four", 12)).toBe("one two…");
    expect(firstSentence("First one. Second one.")).toBe("First one.");
    expect(firstSentence("No end here")).toBe("No end here");
    expect(firstSentence("Version 2.5 is out! More soon.")).toBe("Version 2.5 is out!");
  });

  it("has a state line for every state and a label for every stage", () => {
    expect(pageStateLine({ published: false })).toBe("Not published yet");
    expect(pageStateLine({ published: true, publishedOn: "Oct 7, 2026" })).toBe("Live since Oct 7, 2026");
    expect(pageStateLine({ published: true, publishedOn: "Oct 7, 2026", changed: true })).toBe("Live, with changes not yet published");
    expect(pageStateLine({ published: false, takenDownOn: "Oct 9, 2026" })).toBe("Taken down on Oct 9, 2026. Not public now.");
    expect(PAGE_STAGE_LABELS).toEqual({ idea: "Idea", building: "Being built", live: "Live" });
    for (const reason of PAGE_HOLD_REASONS) expect(PAGE_HOLD_MESSAGES[reason].length).toBeGreaterThan(20);
  });
});

describe("the 'Built on' mark", () => {
  it("is three short things: the mark, the line after a follow with its link, and the foot of the confirmation", () => {
    const words = builtOnWords("Foundmill");
    expect(words.mark).toBe("Built on Foundmill");
    expect(words.afterFollow("Maple\nBakes")).toBe("Maple Bakes is built on Foundmill.");
    expect(words.afterFollowLink).toBe("Start your own");
    expect(words.afterFollowStoryLink).toBe("See how it was made");
    expect(words.foot("Maple Bakes")).toBe("Maple Bakes is built on Foundmill.");
    expect(words.previewNote).toBe("The small line at the foot is removed on a paid plan.");
  });

  it("the confirmation email carries the foot only when it is given one, on one line, after everything else", () => {
    const link = "https://mail.example/mail/confirm?t=abc";
    const plain = FOLLOW_CONFIRM_EMAIL.text("Maple Bakes", "Foundmill", link);
    expect(FOLLOW_CONFIRM_EMAIL.text("Maple Bakes", "Foundmill", link, null)).toBe(plain);
    expect(FOLLOW_CONFIRM_EMAIL.text("Maple Bakes", "Foundmill", link, "Maple Bakes is built on\nFoundmill.")).toBe(`${plain}\n\nMaple Bakes is built on Foundmill.`);
  });
});

