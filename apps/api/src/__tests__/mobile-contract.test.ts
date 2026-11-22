/**
 * The mobile backend skill names api procedures and events (docs/mobile/skills/foundmill-backend/SKILL.md). This test
 * keeps those names true (WP-12 T7): every backticked token made of letters and dots whose first segment is a top-level
 * router of the api must be a procedure path, a prefix of one, or a declared event type. A change to a procedure the
 * skill names updates the skill in the same pull request, or this fails. `a.b.x|y|z` stands for three procedures.
 * It also holds the product skill's "Solo is complete" rule in the pack.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EVENT_TYPES } from "@foundmill/shared";
import { describe, expect, it } from "vitest";
import { appRouter } from "../router";

const ROOT = join(__dirname, "../../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC keeps its procedures on the router definition
const paths = Object.keys((appRouter as any)._def.procedures as Record<string, unknown>);
const routers = new Set(paths.map((p) => p.split(".")[0]!));
const events = new Set<string>(EVENT_TYPES);

/** The names a backticked token stands for: `invitation.byToken|accept|decline` is three. */
function expand(token: string): string[] {
  const parts = token.split(".");
  const last = parts[parts.length - 1]!;
  return last.includes("|") ? last.split("|").map((alt) => [...parts.slice(0, -1), alt].join(".")) : [token];
}

const TOKEN = /^[A-Za-z]+(\.[A-Za-z]+)+(\|[A-Za-z]+)*$/;
const names = (text: string): string[] =>
  [...text.matchAll(/`([^`\n]+)`/g)]
    .map((m) => m[1]!)
    .filter((t) => TOKEN.test(t) && routers.has(t.split(".")[0]!))
    .flatMap(expand);

const known = (name: string) => paths.includes(name) || paths.some((p) => p.startsWith(`${name}.`)) || events.has(name);

describe("the mobile backend skill", () => {
  const skill = read("docs/mobile/skills/foundmill-backend/SKILL.md");

  it("names only procedures, prefixes of procedures and events the api has", () => {
    const found = names(skill);
    expect(found.length).toBeGreaterThan(40);
    const stale = [...new Set(found.filter((n) => !known(n)))];
    expect(stale, `stale names in the mobile backend skill: ${stale.join(", ")}`).toEqual([]);
  });

  it("names the people shapes that are live", () => {
    for (const name of ["invitation.byToken", "invitation.accept", "invitation.decline", "founder.adult.get", "founder.adult.confirm", "publicPage.storyBySlug", "publicPage.cardById", "publicPerson.byHandle", "share.opened", "today.sinceLastVisit", "founder.presence.ping"]) {
      expect(skill, name).toContain(name);
      expect(paths, name).toContain(name);
    }
    for (const word of ["hasProfile", "adult_unconfirmed", "not_invited", "on_waitlist", "invitation_cannot_admit", "invitation_admissions_limit", "cofounder", "collaborator", "arrived"]) expect(skill, word).toContain(word);
  });
});

describe("the mobile pack's rules", () => {
  it("carries the product skill's \"Solo is complete\" rule", () => {
    expect(read("docs/mobile/skills/foundmill-product/SKILL.md")).toMatch(/\*\*Solo is complete\*\*/);
  });
});
