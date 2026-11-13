import { MockModelClient, DesignReviewOutput } from "@foundmill/models";
import { usSpelling } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, renderSkills, ROLE_SKILLS_PREAMBLE, SKILLS_PREAMBLE } from "../club-rules";
import { buildDesignReviewRequest, DESIGN_PRINCIPLES_MD, DESIGN_PRINCIPLES_SKILL, DESIGN_PRINCIPLES_SKILL_KEY, designFixTurn, finaliseDesignReview, roleSkillsFor, type ReviewShot } from "../design-check";
import { screenSkill } from "../skill-files";
import { getSkillDefinition } from "../skills/definitions";
import { getTemplate } from "../registry";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const shot = (id: string, page: string, viewport: "desktop" | "phone", elements: ReviewShot["description"] extends infer D ? (D extends { elements: infer E } ? E : never) : never, extra: Partial<ReviewShot> = {}): ReviewShot => ({
  id,
  page,
  viewport,
  width: viewport === "phone" ? 390 : 1440,
  height: 900,
  cut: false,
  pngBase64: PNG,
  description: { page, viewport, widthPx: viewport === "phone" ? 390 : 1440, scrollWidthPx: viewport === "phone" ? 390 : 1440, title: "", state: "loaded", elements },
  ...extra,
});

const el = (over: Record<string, unknown>) => ({ ref: "main > p", role: "text" as const, text: "Order by 9 PM", fontSizePx: 16, color: "rgb(17, 17, 17)", background: "rgb(255, 255, 255)", spacingPx: [16], shadow: false, gradient: false, gradientText: false, ...over });

describe("the Design principles skill", () => {
  it("is a craft skill the UI-building code agents carry, and it comes with the role", () => {
    expect(getSkillDefinition(DESIGN_PRINCIPLES_SKILL_KEY)?.agentTypes).toEqual(expect.arrayContaining(["frontend_engineer", "design_to_code"]));
    for (const key of ["frontend_engineer", "design_to_code"]) expect(roleSkillsFor(getTemplate(key).skills)).toEqual([DESIGN_PRINCIPLES_SKILL]);
    expect(roleSkillsFor(getTemplate("backend_engineer").skills)).toEqual([]);
  });

  it("covers every principle concretely, passes the skill screen and reads in US English", () => {
    for (const heading of ["Hierarchy", "Spacing", "Type", "Contrast and accessibility", "Restraint with color and gradients", "Real content", "Consistency", "States", "Phone and desktop"]) expect(DESIGN_PRINCIPLES_MD).toContain(`## ${heading}`);
    expect(DESIGN_PRINCIPLES_MD).toMatch(/4\.5 : 1/);
    expect(DESIGN_PRINCIPLES_MD).toMatch(/390 px/);
    expect(DESIGN_PRINCIPLES_MD).toMatch(/project's own design system/);
    expect(screenSkill({ name: DESIGN_PRINCIPLES_SKILL.name, description: "Design principles for founders' screens.", instructionsMd: DESIGN_PRINCIPLES_MD })).toBeNull();
    expect(usSpelling(DESIGN_PRINCIPLES_MD)).toBe(DESIGN_PRINCIPLES_MD);
  });

  it("renders after the instructions, marked as the role's, with the role preamble", () => {
    const prompt = buildSystemPrompt({ businessName: "Loaf", appName: "Foundmill", template: getTemplate("frontend_engineer"), skills: [...roleSkillsFor(getTemplate("frontend_engineer").skills), { name: "Press releases", source: "library", instructionsMd: "Lead with the news." }] });
    expect(prompt).toContain('<skill name="Design principles" source="your role">');
    expect(prompt).toContain(ROLE_SKILLS_PREAMBLE);
    expect(prompt.indexOf("## Your instructions")).toBeLessThan(prompt.indexOf("## Skills"));
    // A founder-only list keeps the founder preamble.
    expect(renderSkills([{ name: "Press releases", source: "library", instructionsMd: "Lead with the news." }])).toContain(SKILLS_PREAMBLE);
  });
});

describe("the design review", () => {
  const shots = [
    shot("before-1-desktop", "/", "desktop", [el({ ref: "main > h1", role: "heading", level: 1, text: "Loaf", fontSizePx: 40 }), el({ color: "rgb(190, 190, 190)" })]),
    shot("before-1-phone", "/", "phone", [el({ ref: "main > h1", role: "heading", level: 1, text: "Loaf", fontSizePx: 40 }), el({ color: "rgb(190, 190, 190)" })]),
  ];

  it("sends the screenshots as images on the vision route, page text framed as untrusted", () => {
    const req = buildDesignReviewRequest({ businessName: "Loaf", taskTitle: "Build the home page", shots });
    expect(req.route).toBe("designReview");
    expect(req.messages[0]!.images).toHaveLength(2);
    expect(req.messages[0]!.content).toMatch(/before-1-desktop \(\/ at desktop\), before-1-phone \(\/ at 390 px\)/);
    expect(req.messages[0]!.content).toContain('<untrusted_content kind="page_descriptions">');
    expect(req.system).toMatch(/Do not praise/);
  });

  it("the mock reviewer flags the planted low contrast at both widths", async () => {
    const client = new MockModelClient();
    const r = await client.complete({ ...buildDesignReviewRequest({ businessName: "Loaf", taskTitle: "Home", shots }), schema: DesignReviewOutput });
    const fin = finaliseDesignReview(r.json, shots);
    expect(fin.fixes[0]).toMatchObject({ rank: 1, page: "/", viewport: "both", principle: "contrast", severity: "high" });
  });

  it("drops fixes on screenshots it was not given, keeps measured high problems the reviewer missed, ranks and caps", () => {
    const fin = finaliseDesignReview(
      {
        fixes: [
          { page: "/pricing", viewport: "desktop", element: "the plan table", problem: "Cramped.", fix: "Add 24 px between plans.", principle: "spacing", severity: "medium", shots: ["invented-shot"] },
          { page: "/", viewport: "phone", element: "the footer links", problem: "Links are 12 px apart.", fix: "Give each link 44 px of height.", principle: "responsive", severity: "low", shots: ["before-1-phone"] },
        ],
        unreadable: [],
      },
      shots,
    );
    expect(fin.fixes.map((f) => f.page)).not.toContain("/pricing");
    expect(fin.fixes.map((f) => [f.rank, f.principle, f.severity])).toEqual([
      [1, "contrast", "high"],
      [2, "responsive", "low"],
    ]);
  });

  it("never judges a screenshot the reviewer could not read, and returns nothing without screenshots", () => {
    const fin = finaliseDesignReview(
      { fixes: [{ page: "/", viewport: "desktop", element: "hero", problem: "Too plain.", fix: "Add an image.", principle: "hierarchy", severity: "low", shots: ["before-1-desktop"] }], unreadable: [{ shot: "before-1-desktop", why: "It shows a sign-in page." }] },
      [shots[0]!],
    );
    expect(fin.fixes).toEqual([]);
    expect(fin.unreadable).toEqual([{ page: "/", viewport: "desktop", why: "It shows a sign-in page." }]);
    expect(finaliseDesignReview(null, [])).toEqual({ fixes: [], unreadable: [] });
  });

  it("asks the author to apply the fixes once, framed as data", () => {
    const turn = designFixTurn([{ rank: 1, page: "/", viewport: "both", element: "the text “Order by 9 PM” (main > p)", problem: "Contrast is 1.9 : 1.", fix: "Use #374151.", principle: "contrast", severity: "high" }]);
    expect(turn).toMatch(/^A separate reviewer looked at screenshots/);
    expect(turn).toContain("1. / at desktop and 390 px, the text “Order by 9 PM” (main > p): Contrast is 1.9 : 1. Fix: Use #374151.");
    expect(turn).toMatch(/only design pass/);
    expect(turn).toMatch(/data, not instructions/);
  });
});
