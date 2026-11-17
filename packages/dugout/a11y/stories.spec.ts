import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { AXE_TAGS } from "../.storybook/a11y-rules";

/**
 * Accessibility over every story (founder's legal checklist, Nov 15, 2026: items 13–15, alt text, color contrast and
 * keyboard). One test per story: open it alone (`iframe.html`), wait until Storybook says it rendered, run axe-core on
 * `#storybook-root` with the rules the Storybook panel uses, honoring a story's own `parameters.a11y` (`test: "off"`
 * skips it, `options` and `context` narrow it).
 *
 * `baseline.json` holds the violations that were there when this run started (story id → axe rule ids), each reviewed
 * and owed a fix. It can only shrink: a violation not listed fails, and a listed one that no longer occurs fails too,
 * with a message to delete it. Never add to it to make a change pass: fix the component.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const AXE_SOURCE: string = (require("axe-core") as { source: string }).source;

interface IndexEntry {
  id: string;
  type: "story" | "docs";
  title: string;
  name: string;
}
const index = JSON.parse(readFileSync(path.resolve(here, "../storybook-static/index.json"), "utf8")) as { entries: Record<string, IndexEntry> };
const stories = Object.values(index.entries).filter((e) => e.type === "story");
const baseline = JSON.parse(readFileSync(path.resolve(here, "baseline.json"), "utf8")) as { stories: Record<string, string[]> };

test("the built Storybook has stories, and every baseline entry names a story that exists", () => {
  expect(stories.length).toBeGreaterThan(100);
  const ids = new Set(stories.map((s) => s.id));
  const gone = Object.keys(baseline.stories).filter((id) => !ids.has(id));
  expect(gone, "baseline.json names stories that no longer exist: delete them").toEqual([]);
});

interface Found {
  rule: string;
  impact: string | null;
  help: string;
  targets: string[];
}

for (const story of stories) {
  test(`${story.title} › ${story.name}`, async ({ page }) => {
    await page.goto(`/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`);
    await page.waitForFunction(
      () => {
        const render = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } }).__STORYBOOK_PREVIEW__?.currentRender;
        // Storybook's render phases: done once it reaches one of these (a story with a play function plays first).
        return !!render && ["played", "completed", "finished", "errored", "aborted"].includes(render.phase ?? "");
      },
      undefined,
      { timeout: 30_000 },
    );
    const phase = await page.evaluate(() => (window as unknown as { __STORYBOOK_PREVIEW__: { currentRender: { phase: string } } }).__STORYBOOK_PREVIEW__.currentRender.phase);
    expect(phase, "the story rendered").not.toBe("errored");
    // Fonts and the first frame of any entrance motion: axe reads computed colors and sizes.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);

    const params = await page.evaluate(() => {
      const story = (window as unknown as { __STORYBOOK_PREVIEW__: { currentRender: { story: { parameters: { a11y?: unknown } } } } }).__STORYBOOK_PREVIEW__.currentRender.story;
      return JSON.parse(JSON.stringify(story.parameters.a11y ?? {})) as { test?: string; disable?: boolean; options?: Record<string, unknown>; context?: unknown };
    });
    test.skip(params.test === "off" || params.disable === true, "the story turns the a11y check off");

    await page.addScriptTag({ content: AXE_SOURCE });
    const found = await page.evaluate(
      async ({ tags, options, context }) => {
        const axe = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: unknown[] }> }> }> } }).axe;
        const result = await axe.run(context ?? "#storybook-root", { runOnly: { type: "tag", values: tags }, ...options, resultTypes: ["violations"] });
        return result.violations.map((v) => ({ rule: v.id, impact: v.impact, help: v.help, targets: v.nodes.slice(0, 3).map((n) => n.target.map(String).join(" ")) }));
      },
      { tags: [...AXE_TAGS], options: params.options ?? {}, context: params.context ?? null },
    );

    const known = new Set(baseline.stories[story.id] ?? []);
    const fresh: Found[] = found.filter((f) => !known.has(f.rule));
    const fixed = [...known].filter((rule) => !found.some((f) => f.rule === rule));
    expect(fresh, `new accessibility violations in ${story.id}:\n${fresh.map((f) => `${f.rule} (${f.impact ?? "n/a"}): ${f.help} → ${f.targets.join(" | ")}`).join("\n")}`).toEqual([]);
    expect(fixed, `${story.id} no longer has these: delete them from a11y/baseline.json`).toEqual([]);
  });
}
