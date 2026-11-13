/**
 * The Terms' "Copyright complaints" (US DMCA, 17 U.S.C. § 512; founder, 2026-11-13): the section is in the Terms and
 * on the page, it gives the intake email and the company's postal address, it names a designated agent and a
 * registration only once COPYRIGHT_AGENT says registered, and it carries the notice, the counter-notice, the 10 to 14
 * business days, repeat infringers and the warning about false notices.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { LegalPage, type LegalSection, type LegalText } from "@foundmill/dugout";
import { COPYRIGHT_AGENT, COPYRIGHT_EMAIL, LEGAL_ENTITY, type CopyrightAgent } from "../facts";
import { DMCA_DIRECTORY_URL, TERMS, copyrightSection } from "../terms";

const parts = (t: LegalText): { text: string; href?: string }[] =>
  (Array.isArray(t) ? t : [t]).map((p) => (typeof p === "string" ? { text: p } : p));

function flatten(section: LegalSection): { text: string; hrefs: string[] } {
  const all: LegalText[] = [section.heading];
  for (const b of section.blocks) {
    if (b.kind === "p") all.push(b.text);
    else if (b.kind === "list") all.push(...b.items);
    else for (const i of b.items) all.push(i.term, i.detail);
  }
  const ps = all.flatMap(parts);
  return { text: ps.map((p) => p.text).join(" "), hrefs: ps.flatMap((p) => (p.href ? [p.href] : [])) };
}

const REGISTERED: CopyrightAgent = {
  registered: true,
  registrationNumber: "DMCA-1234567",
  name: "Copyright Agent",
  postalAddress: "1 Example Street, Example City, Sweden",
  email: COPYRIGHT_EMAIL,
  phone: "+46 8 000 00 00",
};

describe("Copyright complaints in the Terms", () => {
  it("is a section of the Terms, after the acceptable-use rules, and renders on the page with its anchor", () => {
    const ids = TERMS.sections.map((s) => s.id);
    expect(ids).toContain("copyright");
    expect(ids.indexOf("copyright")).toBe(ids.indexOf("acceptable-use") + 1);
    const html = renderToStaticMarkup(createElement(LegalPage, { document: TERMS, links: [{ href: "/terms", label: "Terms", current: true }] }));
    expect(html).toContain('id="copyright"');
    expect(html).toContain("Copyright complaints");
    expect(html).toContain(`href="mailto:${COPYRIGHT_EMAIL}"`);
  });

  it("defaults to not registered: the intake email and the company's postal address, no agent or registration", () => {
    expect(COPYRIGHT_AGENT.registered).toBe(false);
    expect(COPYRIGHT_AGENT.registrationNumber).toBeNull();
    expect(COPYRIGHT_EMAIL).toBe("copyright@foundmill.com");
    const { text, hrefs } = flatten(copyrightSection());
    expect(hrefs).toContain(`mailto:${COPYRIGHT_EMAIL}`);
    expect(text).toContain(LEGAL_ENTITY.postalAddress!);
    expect(text).not.toMatch(/Designated agent|registration number|Designated Agent Directory/);
    expect(hrefs).not.toContain(DMCA_DIRECTORY_URL);
  });

  it("shows the registered agent's details once registered", () => {
    const { text, hrefs } = flatten(copyrightSection(REGISTERED));
    expect(text).toContain("Designated agent");
    expect(text).toContain(REGISTERED.name);
    expect(text).toContain(REGISTERED.postalAddress!);
    expect(text).toContain(REGISTERED.phone!);
    expect(text).toContain("registration number DMCA-1234567");
    expect(hrefs).toContain(`mailto:${COPYRIGHT_EMAIL}`);
    expect(hrefs).toContain(DMCA_DIRECTORY_URL);
    // A registered agent without its own address or a phone falls back to the company's address and leaves the phone out.
    const bare = flatten(copyrightSection({ ...REGISTERED, postalAddress: null, phone: null })).text;
    expect(bare).toContain(LEGAL_ENTITY.postalAddress!);
    expect(bare).not.toContain("Phone");
  });

  it("carries the notice, the counter-notice, the restore window, repeat infringers and false notices", () => {
    const { text } = flatten(copyrightSection());
    expect(text).toMatch(/17 U\.S\.C\. § 512/);
    // § 512(c)(3): the six elements of a notice.
    for (const element of [/physical or electronic signature/, /copyrighted work/, /enough information for us to find it/, /telephone number and email address/, /good faith that the use of the material/, /under penalty of perjury, that you are the copyright owner/]) expect(text).toMatch(element);
    expect(text).toMatch(/promptly remove the material or disable access to it/);
    expect(text).toMatch(/tell the person who posted it/);
    // § 512(g): the counter-notice and the window.
    expect(text).toMatch(/counter-notice/);
    expect(text).toMatch(/removed or disabled by mistake or because it was misidentified/);
    expect(text).toMatch(/consent to the jurisdiction of the US federal district court/);
    expect(text).toMatch(/accept service of process/);
    expect(text).toMatch(/no sooner than 10 and no later than 14 business days/);
    expect(text).toMatch(/filed a court action/);
    // § 512(i) and § 512(f).
    expect(text).toMatch(/In appropriate circumstances, we close the accounts of people who repeatedly infringe copyrights/);
    expect(text).toMatch(/512\(f\)/);
    expect(text).toMatch(/liable for damages/);
  });
});
