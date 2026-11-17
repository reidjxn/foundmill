/**
 * The accessibility rule set (WCAG 2.2 AA, BUILD §5.4), in one place: the Storybook a11y panel (`preview.ts`), the run
 * over every story in CI (`a11y/stories.spec.ts`) and the run over the web app's real pages (apps/web `e2e/axe.ts`)
 * all use these axe tags, so a story and a page are held to the same rules.
 */
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] as const;
