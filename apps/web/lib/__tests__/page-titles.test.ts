/**
 * Browser titles inside a business (audit A11Y-15, WCAG 2.4.2): every screen names itself, then the business, then the
 * product. Before, no page under app/b/[bid] gave the layout's template its "%s", so every screen read
 * "<business> · Foundmill". The titles are rendered in the browser by components/shell/BusinessTitle.tsx from the route
 * (audit WEB-5: Next metadata asked the API for the business on every navigation), so no route there may set a Next
 * title as well: the document would hold two.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentTitle, businessDocumentTitle, businessScreenTitle, departmentTitle, entityIdOfPath, entityTitle, settingsTitle } from "../page-titles";

const BUSINESS_APP = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "app", "b", "[bid]");

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pages(path);
    return name === "page.tsx" ? [path] : [];
  });
}

const DEPARTMENTS = [
  { slug: "finance", name: "Finance", tabs: [{ slug: "overview", title: "Overview" }, { slug: "cash", title: "Cash" }], squad: [{ id: "a1", name: "Mara" }] },
  { slug: "team", name: "Team", tabs: [{ slug: "squad", title: "Agents" }], squad: [{ id: "a2", name: "Chief of Staff" }] },
];

describe("page titles", () => {
  it("every screen under /b/[bid] has its screen name by route (redirects aside)", () => {
    const BID = "b1e5e5e5-0000-4000-8000-000000000001";
    // A sample value for each dynamic segment; optional catch-alls are left out.
    const sample: Record<string, string> = { "[bid]": BID, "[deptSlug]": "finance", "[tabSlug]": "cash", "[agentId]": "a1", "[tab]": "training", "[entityId]": "e1", "[journeyId]": "j1" };
    const missing = pages(BUSINESS_APP)
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        if (/\bredirect\(/.test(src) && !/<\w+Screen\b/.test(src)) return false;
        const segments = relative(BUSINESS_APP, dirname(file)).split(/[\\/]/).filter((seg) => seg && !seg.startsWith("[[..."));
        const path = `/b/${BID}/${segments.map((seg) => sample[seg] ?? seg).join("/")}`;
        return businessScreenTitle(path, BID, DEPARTMENTS) === null;
      })
      .map((file) => relative(BUSINESS_APP, file));
    expect(missing).toEqual([]);
  });

  it("no route under /b/[bid] sets a Next title: <BusinessTitle> renders the only one", () => {
    const withTitle = [...pages(BUSINESS_APP), join(BUSINESS_APP, "layout.tsx")]
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        if (/export async function generateMetadata\b/.test(src)) return true;
        const metadata = /export const metadata\b[^=]*=\s*({[^;]*});/.exec(src);
        return !!metadata && !/^\{\s*title:\s*null\s*\}$/.test(metadata[1]!);
      })
      .map((file) => relative(BUSINESS_APP, file));
    expect(withTitle).toEqual([]);
  });

  it("the whole title carries the screen, the business and the product", () => {
    expect(businessDocumentTitle("Inbox", "Northwind Skincare", "Foundmill")).toBe("Inbox · Northwind Skincare · Foundmill");
    expect(businessDocumentTitle(null, "Northwind Skincare", "Foundmill")).toBe("Northwind Skincare · Foundmill");
  });

  it("names each route as its page used to (the strings e2e/titles-not-found.spec.ts reads)", () => {
    const B = "b1e5e5e5-0000-4000-8000-000000000001";
    const title = (path: string, entityName: string | null = null) => businessScreenTitle(`/b/${B}${path}`, B, DEPARTMENTS, entityName);
    expect(title("/home")).toBe("Home");
    expect(title("/home/5f2b8c1e-9a4d-4c3b-8e7f-1a2b3c4d5e6f")).toBe("Home");
    expect(title("/inbox")).toBe("Inbox");
    expect(title("/inbox/item-1")).toBe("Inbox");
    expect(title("/crm")).toBe("CRM");
    expect(title("/crm/e1/activity", "Acme Ltd")).toBe("Activity · Acme Ltd");
    expect(title("/crm/e1/overview")).toBe("Overview · CRM");
    expect(title("/milestones")).toBe("Milestones");
    expect(title("/journey/j1")).toBe("Customer Update");
    expect(title("/settings/members")).toBe("Members · Settings");
    expect(title("/settings/danger")).toBe("Danger zone · Settings");
    expect(title("/settings/nope")).toBe("Settings");
    expect(title("/d/finance/overview")).toBe("Overview · Finance");
    expect(title("/d/finance/nope")).toBe("Finance");
    expect(title("/d/nope/overview")).toBe("Department");
    expect(title("/agents/a1/training")).toBe("Training · Mara");
    expect(title("/agents/not-a-uuid/overview")).toBe("Overview · Agent");
    expect(title("")).toBeNull();
    expect(businessScreenTitle(`/b/other/home`, B, DEPARTMENTS)).toBeNull();
    expect(businessScreenTitle(`/b/${B}x/home`, B, DEPARTMENTS)).toBeNull();
    expect(entityIdOfPath(`/b/${B}/crm/e1/notes`, B)).toBe("e1");
    expect(entityIdOfPath(`/b/${B}/crm`, B)).toBeNull();
    expect(entityIdOfPath(`/b/${B}/inbox/e1`, B)).toBeNull();
  });

  it("names settings sections, department tabs, agents and entities", () => {
    expect(settingsTitle("members")).toBe("Members · Settings");
    expect(settingsTitle("danger")).toBe("Danger zone · Settings");
    expect(settingsTitle("nope")).toBe("Settings");
    expect(departmentTitle(DEPARTMENTS, "finance", "cash")).toBe("Cash · Finance");
    expect(departmentTitle(DEPARTMENTS, "finance", "nope")).toBe("Finance");
    expect(departmentTitle(DEPARTMENTS, "nope", "cash")).toBe("Department");
    expect(agentTitle(DEPARTMENTS, "a2", "training")).toBe("Training · Chief of Staff");
    expect(agentTitle(DEPARTMENTS, "missing", "overview")).toBe("Overview · Agent");
    expect(agentTitle(DEPARTMENTS, "a1", "profile")).toBe("Mara");
    expect(entityTitle("Acme Ltd", "activity")).toBe("Activity · Acme Ltd");
    expect(entityTitle(null, "overview")).toBe("Overview · CRM");
  });
});
