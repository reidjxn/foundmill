import { createRequire } from "node:module";
import { expect, test, type Page } from "@playwright/test";
// The one rule list the stories use too (a relative import: the design system's barrel is not for Node).
import { AXE_TAGS } from "../../../packages/dugout/.storybook/a11y-rules";

/**
 * Automated accessibility checks on real pages (founder's legal checklist, Nov 15, 2026, items 13–15: alt text, color
 * contrast, keyboard): axe-core run in the page, against the same WCAG 2.2 AA rule set the design system's stories are
 * held to (packages/dugout/.storybook/a11y-rules.ts). Every violation fails (bar the reviewed `KNOWN_EXCEPTIONS`), with its rule, impact,
 * how many elements and the first few selectors, so the failure says what to fix.
 *
 * axe-core is injected from the web's own dependency (no CDN, no extra wrapper package). Third-party frames we do not
 * control (Cloudflare Turnstile) are left out.
 */
const require = createRequire(import.meta.url);
const AXE_SOURCE: string = (require("axe-core") as { source: string }).source;

export { AXE_TAGS };

/**
 * Reviewed exceptions, each owed a fix: a violation that matches one is reported in the test's annotations, not
 * failed. Keep this list short and specific (a rule and the elements it may flag); never add one to make a change pass.
 */
export const KNOWN_EXCEPTIONS: ReadonlyArray<{ rule: string; target: RegExp; why: string }> = [
  {
    rule: "target-size",
    target: /term-link|est-chip|data-term=/,
    why: "A defined word (Term, 14 px) and the Estimate chip (18 px, the badge token) sit on a clickable tile in the status strip; 24 px targets there are a design change (follow-up).",
  },
];

/** Frames and elements axe never looks inside: services we embed but do not control. */
const EXCLUDE = [["iframe[src*='challenges.cloudflare.com']"], ["[data-follow-widget]"]];

export interface AxeViolation {
  rule: string;
  impact: string | null;
  help: string;
  count: number;
  targets: string[];
}

/** Runs axe on the page as it is now and returns the violations (empty when it passes). */
export async function axeViolations(page: Page): Promise<AxeViolation[]> {
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(
    async ({ tags, exclude }) => {
      const axe = (window as unknown as { axe: { run: (ctx: unknown, opts: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
      const result = await axe.run({ include: [["html"]], exclude }, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
      return result.violations.map((v) => ({ rule: v.id, impact: v.impact, help: v.help, count: v.nodes.length, targets: v.nodes.slice(0, 5).map((n) => n.target.map(String).join(" ")) }));
    },
    { tags: [...AXE_TAGS], exclude: EXCLUDE },
  );
}

/** One line per violation: `color-contrast (serious, 3): Elements must meet … → .a, .b`. */
export function describeViolations(violations: AxeViolation[]): string {
  return violations.map((v) => `${v.rule} (${v.impact ?? "n/a"}, ${v.count}): ${v.help} → ${v.targets.join(" | ")}`).join("\n");
}

/** Splits violations into the ones that fail and the reviewed exceptions (a violation is excepted only when every element it flags matches). */
export function triageViolations(violations: AxeViolation[]): { failing: AxeViolation[]; excepted: AxeViolation[] } {
  const excepted = violations.filter((v) => KNOWN_EXCEPTIONS.some((k) => k.rule === v.rule && v.count <= v.targets.length && v.targets.every((t) => k.target.test(t))));
  return { failing: violations.filter((v) => !excepted.includes(v)), excepted };
}

/** Fails the test with every violation axe finds on the page as it is now, the reviewed exceptions aside. */
export async function expectNoAxeViolations(page: Page, where: string): Promise<void> {
  const { failing, excepted } = triageViolations(await axeViolations(page));
  if (excepted.length > 0) test.info().annotations.push({ type: "a11y-exception", description: `${where}: ${describeViolations(excepted)}` });
  expect(failing, `accessibility violations on ${where}:\n${describeViolations(failing)}`).toEqual([]);
}
