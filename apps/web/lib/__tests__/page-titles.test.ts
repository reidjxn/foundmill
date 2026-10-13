/**
 * Browser titles inside a business (audit A11Y-15, WCAG 2.4.2): every screen names itself, then the business, then the
 * product. Before, no page under app/b/[bid] gave the layout's template its "%s", so every screen read
 * "<business> · Foundmill".
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentTitle, businessTitleTemplate, departmentTitle, entityTitle, settingsTitle } from "../page-titles";

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
  it("every screen under /b/[bid] gives the layout's template its screen name (redirects aside)", () => {
    const missing = pages(BUSINESS_APP)
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        if (/\bredirect\(/.test(src) && !/<\w+Screen\b/.test(src)) return false;
        return !/export const metadata\b|export async function generateMetadata\b/.test(src);
      })
      .map((file) => relative(BUSINESS_APP, file));
    expect(missing).toEqual([]);
  });

  it("the business template carries the screen, the business and the product (Next applies only the nearest template)", () => {
    expect(businessTitleTemplate("Northwind Skincare", "Foundmill").replace("%s", "Inbox")).toBe("Inbox · Northwind Skincare · Foundmill");
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
