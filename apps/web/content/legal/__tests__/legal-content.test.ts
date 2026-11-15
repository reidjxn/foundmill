/**
 * The Terms and the Privacy Policy stay true and well formed (founder, 2026-11-13): the company's name only on the two
 * legal pages, the cookies the policy lists are the cookies the site sets, every link is one the page will follow,
 * every anchor is unique, and US English (the CI checks cover the words; this covers the structure).
 */
import { APP_NAME } from "@foundmill/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeLegalHref, type LegalDocument, type LegalText } from "@foundmill/dugout";
import { IDEA_COOKIE } from "@foundmill/shared";
import { APP_POSTAL_ADDRESS } from "@foundmill/config";
import { VIA_COOKIE, VIA_POST_COOKIE, VIA_POST_MAX_AGE_SECONDS } from "@foundmill/shared/via";
import { LAST_BUSINESS_COOKIE } from "@/lib/auth/constants";
import { DATE_FORMAT_COOKIE } from "@/lib/date-format";
import { TEXT_SIZE_COOKIE } from "@/components/providers/text-size-cookie";
import { FOLLOW_PRIVACY_HREF } from "@foundmill/shared/project-page";
import { LEGAL_CONTACT_EMAIL, LEGAL_ENTITY, LEGAL_ROUTES, entityLine } from "../facts";
import { FOLLOW_CONFIRM_DAYS, POST_COOKIE_DAYS, PRIVACY, PRIVACY_COOKIES } from "../privacy";
import { TERMS } from "../terms";

const REPO = resolve(__dirname, "../../../../..");
const LEGAL_DIR = join("apps", "web", "content", "legal");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "dist" || name === "storybook-static" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|json|css|html|md)$/.test(name)) out.push(p);
  }
  return out;
}

const texts = (t: LegalText): string[] => (typeof t === "string" ? [t] : Array.isArray(t) ? t.flatMap((p) => (typeof p === "string" ? [p] : [p.text])) : [(t as { text: string }).text]);
const links = (t: LegalText): string[] => (typeof t === "string" ? [] : Array.isArray(t) ? t.flatMap((p) => (typeof p === "string" ? [] : [p.href])) : [(t as { href: string }).href]);

function walk(doc: LegalDocument): { text: string[]; hrefs: string[] } {
  const all: LegalText[] = [...(doc.summary ?? [])];
  for (const s of doc.sections) {
    all.push(s.heading);
    for (const b of s.blocks) {
      if (b.kind === "p") all.push(b.text);
      else if (b.kind === "list") all.push(...b.items);
      else for (const i of b.items) all.push(i.term, i.detail);
    }
  }
  return { text: all.flatMap(texts), hrefs: all.flatMap(links) };
}

describe("the legal pages", () => {
  it("name the company only on the two legal pages: nowhere else in the apps or packages", () => {
    const found = [...sourceFiles(join(REPO, "apps")), ...sourceFiles(join(REPO, "packages"))]
      .map((p) => relative(REPO, p))
      .filter((p) => !p.startsWith(LEGAL_DIR + sep))
      .filter((p) => /collingham/i.test(readFileSync(join(REPO, p), "utf8")));
    expect(found).toEqual([]);
  });

  it("take the registered address from its one source, which holds the address and not the name", () => {
    expect(LEGAL_ENTITY.postalAddress).toBe(APP_POSTAL_ADDRESS);
    expect(entityLine()).toContain(APP_POSTAL_ADDRESS);
    // The street is written once, in packages/config (every email Foundmill sends shows it, US CAN-SPAM).
    const street = APP_POSTAL_ADDRESS.split(",")[0]!;
    const holders = [...sourceFiles(join(REPO, "apps")), ...sourceFiles(join(REPO, "packages"))]
      .map((p) => relative(REPO, p))
      .filter((p) => readFileSync(join(REPO, p), "utf8").includes(street));
    expect(holders).toEqual([join("packages", "config", "src", "brand.ts")]);
  });

  it("state the company, its number and its country in both documents", () => {
    for (const doc of [TERMS, PRIVACY]) {
      const text = walk(doc).text.join(" ");
      expect(text).toContain(entityLine());
      expect(text).toContain(LEGAL_ENTITY.orgNumber);
    }
  });

  it("list exactly the cookies the site sets (the development-only sign-in cookies aside)", () => {
    const listed = PRIVACY_COOKIES.map((c) => c.term).filter((t) => !t.startsWith("sb-"));
    expect(listed.sort()).toEqual([LAST_BUSINESS_COOKIE, DATE_FORMAT_COOKIE, TEXT_SIZE_COOKIE, IDEA_COOKIE, VIA_COOKIE, VIA_POST_COOKIE].sort());
    expect(PRIVACY_COOKIES.some((c) => c.term.startsWith("sb-") && c.term.endsWith("auth-token"))).toBe(true);
  });

  it("says how long fm_post lives from the constant the cookie is set with: exactly 7 days (604,800 seconds)", () => {
    expect(VIA_POST_MAX_AGE_SECONDS).toBe(604_800);
    expect(POST_COOKIE_DAYS).toBe(7);
    const row = PRIVACY_COOKIES.find((c) => c.term === VIA_POST_COOKIE)!;
    expect(row.detail).toBe(`Remembers the public code in the link of the last post from a project on ${APP_NAME} that brought you here, if one did, so the project can see which post led to your follow. 7 days.`);
    expect(row.detail.endsWith(`${POST_COOKIE_DAYS} days.`)).toBe(true);
  });

  it("has the section the Follow form links, saying what happens to a follower's address, from the constants the code uses", () => {
    const [path, anchor] = FOLLOW_PRIVACY_HREF.split("#");
    expect(path).toBe(LEGAL_ROUTES.privacy);
    const section = PRIVACY.sections.find((s) => s.id === anchor);
    expect(section, `Privacy Policy section "${anchor}"`).toBeDefined();
    const text = walk({ ...PRIVACY, summary: [], sections: [section!] }).text.join(" ");
    expect(FOLLOW_CONFIRM_DAYS).toBe(7);
    expect(text).toContain(`works for ${FOLLOW_CONFIRM_DAYS} days`);
    for (const fact of [/confirm/, /contacts/, /unsubscribe/i, /responsible/, /deleted/]) expect(text).toMatch(fact);
    expect(walk({ ...PRIVACY, summary: [], sections: [section!] }).hrefs).toContain(`mailto:${LEGAL_CONTACT_EMAIL}`);
  });

  it("link only to places the page follows, with unique anchors, and hold no placeholders", () => {
    for (const doc of [TERMS, PRIVACY]) {
      const { text, hrefs } = walk(doc);
      for (const h of hrefs) expect(isSafeLegalHref(h), h).toBe(true);
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      const body = text.join("\n");
      expect(body).not.toMatch(/\b(TODO|TBD|lorem|\[[A-Z ]+\])\b/);
      // US dates (CLAUDE.md): "Nov 13, 2026".
      expect(doc.updated).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
    }
  });

  it("say the age, that agents never move money or sign, and that nothing is sold or used for training", () => {
    const terms = walk(TERMS).text.join(" ");
    expect(terms).toMatch(/18 or older/);
    expect(terms).toMatch(/move money/);
    expect(terms).toMatch(/Swedish|Sweden/);
    const privacy = walk(PRIVACY).text.join(" ");
    expect(privacy).toMatch(/do not sell/);
    expect(privacy).toMatch(/train AI models/);
    expect(privacy).toMatch(/Limited Use/);
    // Cloudflare requires Invisible-mode sites to link its Turnstile Privacy Addendum (the idea box's bot check).
    expect(walk(PRIVACY).hrefs).toContain("https://www.cloudflare.com/turnstile-privacy-policy/");
    expect(privacy).toMatch(/Cloudflare Turnstile to block automated abuse/);
  });
});
