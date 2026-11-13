import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { LEGAL_PAGE_WORDS, LegalPage, isSafeLegalHref, type LegalDocument } from "./LegalPage";

const doc: LegalDocument = {
  title: "Privacy Policy",
  updated: "Nov 13, 2026",
  summary: ["We collect what we need.", ["Write to ", { text: "privacy@example.com", href: "mailto:privacy@example.com" }, "."]],
  sections: [
    { id: "who-we-are", heading: "Who we are", blocks: [{ kind: "p", text: ["See the ", { text: "Terms", href: "/terms" }, "."] }] },
    { id: "cookies", heading: "Cookies", blocks: [{ kind: "list", items: ["One", "Two"] }, { kind: "terms", items: [{ term: "fm_text_size", detail: "The text size you chose." }] }] },
    { id: "unsafe", heading: "Links", blocks: [{ kind: "p", text: [{ text: "not a link", href: "javascript:alert(1)" }, " ", { text: "elsewhere", href: "//evil.example" }] }] },
  ],
};
const links = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy", current: true },
];

describe("LegalPage", () => {
  it("shows the title, the date, the short version, the contents and numbered sections with anchors", () => {
    render(<LegalPage document={doc} links={links} />);
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy();
    expect(document.querySelector("[data-legal-updated]")!.textContent).toBe(`${LEGAL_PAGE_WORDS.updated} Nov 13, 2026`);
    expect(screen.getByRole("heading", { level: 2, name: LEGAL_PAGE_WORDS.summary })).toBeTruthy();
    expect([...document.querySelectorAll("[data-legal-summary] li")].map((li) => li.textContent)).toEqual(["We collect what we need.", "Write to privacy@example.com."]);
    const contents = [...document.querySelectorAll("[data-legal-contents] a")];
    expect(contents.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Who we are", "#who-we-are"],
      ["Cookies", "#cookies"],
      ["Links", "#unsafe"],
    ]);
    const h = document.getElementById("cookies")!;
    expect(h.tagName).toBe("H2");
    expect(h.textContent).toBe("2. Cookies");
    expect([...document.querySelectorAll("[data-legal-section=cookies] li")].map((li) => li.textContent)).toEqual(["One", "Two"]);
    expect(document.querySelector("[data-legal-terms] dt")!.textContent).toBe("fm_text_size");
  });

  it("links in-site paths and mailto, and prints anything else as text", () => {
    render(<LegalPage document={doc} links={links} />);
    expect(screen.getByRole("link", { name: "privacy@example.com" }).getAttribute("href")).toBe("mailto:privacy@example.com");
    expect(document.querySelector("[data-legal-section=who-we-are] a")!.getAttribute("href")).toBe("/terms");
    expect(document.querySelector("[data-legal-section=unsafe] a")).toBeNull();
    expect(document.querySelector("[data-legal-section=unsafe] p")!.textContent).toBe("not a link elsewhere");
    for (const ok of ["/terms", "#cookies", "https://example.com", "mailto:a@b.co"]) expect(isSafeLegalHref(ok), ok).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.example", "http://example.com", "data:text/html,x", "ftp://x"]) expect(isSafeLegalHref(bad), bad).toBe(false);
  });

  it("marks the current document in the bar and the footer, and links the other", () => {
    render(<LegalPage document={doc} links={links} />);
    expect(screen.getAllByText("Privacy").every((el) => el.getAttribute("aria-current") === "page" && el.tagName === "SPAN")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Terms" }).filter((a) => a.getAttribute("href") === "/terms").length).toBeGreaterThanOrEqual(2);
    expect(document.querySelector("[data-legal-home]")!.getAttribute("href")).toBe("/");
  });

  it("leaves the short version out when there is none, and renders on the server as text only", () => {
    const html = renderToStaticMarkup(<LegalPage document={{ ...doc, summary: [], sections: [{ id: "a", heading: "<b>x</b>", blocks: [{ kind: "p", text: "<script>alert(1)</script>" }] }] }} links={links} />);
    expect(html).not.toContain("data-legal-summary");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
