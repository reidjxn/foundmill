/** The pure parts of "Ask <Chief of Staff>": the page context sent with a question and the desk's first words. */
import { describe, expect, it } from "vitest";
import { CHIEF_PURPOSE_MAX } from "@foundmill/shared";
import { areaOfPath, chiefDeskPersona, continueText, pageContextFor } from "../ask-chief";

const departments = [
  { slug: "finance", moduleKeys: ["finance"] },
  { slug: "product", moduleKeys: ["product"] },
  { slug: "growth", moduleKeys: ["distribution"] },
  { slug: "team", moduleKeys: ["team"] },
];

describe("areaOfPath", () => {
  it("finds the area of a department tab by its module", () => {
    expect(areaOfPath("/b/x/d/finance/overview", departments)).toBe("money");
    expect(areaOfPath("/b/x/d/growth/channels", departments)).toBe("customers");
    expect(areaOfPath("/b/x/d/team/squad", departments)).toBe("team");
  });

  it("puts the roadmap in Plan, and Contacts and Milestones in their areas", () => {
    expect(areaOfPath("/b/x/d/product/roadmap", departments)).toBe("plan");
    expect(areaOfPath("/b/x/crm", departments)).toBe("customers");
    expect(areaOfPath("/b/x/milestones", departments)).toBe("plan");
    expect(areaOfPath("/b/x/trophies", departments)).toBe("plan");
  });

  it("has no area for Today, Needs you, settings or a department it does not know", () => {
    expect(areaOfPath("/b/x/today", departments)).toBeNull();
    expect(areaOfPath("/b/x/inbox?tab=respond", departments)).toBeNull();
    expect(areaOfPath("/b/x/settings/mode", departments)).toBeNull();
    expect(areaOfPath("/b/x/d/nope/overview", departments)).toBeNull();
  });
});

describe("pageContextFor", () => {
  it("carries the path, the area and the registered screen's plain purpose line", () => {
    expect(pageContextFor("/b/x/d/finance/runway", departments, { screenId: "finance/runway", purpose: "How many months your cash lasts." })).toEqual({ path: "/b/x/d/finance/runway", screenId: "finance/runway", area: "money", purpose: "How many months your cash lasts." });
  });

  it("leaves out a purpose that is not plain text or is too long, and works without a registered screen", () => {
    expect(pageContextFor("/b/x/today", departments, { screenId: "home", purpose: { not: "text" } }).purpose).toBeNull();
    expect(pageContextFor("/b/x/today", departments, { screenId: "home", purpose: "x".repeat(CHIEF_PURPOSE_MAX + 1) }).purpose).toBeNull();
    expect(pageContextFor("/b/x/today", departments, null)).toEqual({ path: "/b/x/today", screenId: null, area: null, purpose: null });
  });
});

describe("the desk", () => {
  it("opens with the question as the founder read it", () => {
    expect(continueText("happening")).toBe("What's happening?");
    expect(continueText("blocking")).toBe("What's blocking us?");
    expect(continueText("why")).toBe("Why am I seeing this?");
  });

  it("introduces the Chief of Staff in its own department's color, else the first department's", () => {
    const chief = { id: "c1", name: "Ines Park", role: "Chief of Staff", avatarSeed: "", personaKey: "ines", departmentId: "d2" };
    const ds = [{ id: "d1", colourToken: "dept-1" }, { id: "d2", colourToken: "dept-4" }];
    expect(chiefDeskPersona(chief, ds)).toEqual({ name: "Ines Park", role: "Chief of Staff", avatarSeed: "c1", personaKey: "ines", dept: "dept-4" });
    expect(chiefDeskPersona({ ...chief, departmentId: null }, ds).dept).toBe("dept-1");
    expect(chiefDeskPersona({ ...chief, departmentId: null }, []).dept).toBe("dept-1");
  });
});
