/**
 * A project's public page as Markdown (WP-08 T7; audit s3 §5.3), served at `/p/<slug>/index.md` and `/p/<slug>/llms.txt`
 * for AI readers. Everything in it is already public on the page or its story; nothing new is exposed. Dates are US
 * dates ("Oct 7, 2026").
 */
import { builtByLine, pageParagraphs, PAGE_STAGE_LABELS, type PageStage } from "./project-page";

export interface MarkdownPageInput {
  url: string;
  name: string;
  pitch: string;
  about: string;
  forWhom: string;
  stage: PageStage;
  publishedAt: Date | string;
  updatedAt: Date | string;
  founderNames: readonly string[];
}

const usDay = (d: Date | string): string => (d instanceof Date ? d : new Date(d)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
/** One line of text: no line breaks, so founder text cannot start a heading or a list item of its own. */
const line = (s: string): string => s.replace(/\s+/g, " ").trim();
/** A paragraph that would read as a heading, quote or list item starts with a backslash instead. */
const block = (s: string): string => (/^(?:[#>*+-]|\d+[.)])/.test(s) ? `\\${s}` : s);

export function projectPageMarkdown(view: MarkdownPageInput, milestones: readonly { label: string; achievedAt: Date | string }[], opts: { appName: string }): string {
  const published = usDay(view.publishedAt);
  const updated = usDay(view.updatedAt);
  const built = builtByLine(view.founderNames);
  const out: string[] = [`# ${line(view.name)}`, "", `> ${line(view.pitch)}`, "", `- Stage: ${PAGE_STAGE_LABELS[view.stage]}`, `- Published: ${published}${updated !== published ? ` · Updated: ${updated}` : ""}`];
  if (built) out.push(`- ${built}`);
  out.push(`- Page: ${view.url}`);
  const about = pageParagraphs(view.about).map(line).filter(Boolean).map(block);
  if (about.length) out.push("", "## About", "", about.join("\n\n"));
  if (view.forWhom.trim()) out.push("", "## Who it is for", "", block(line(view.forWhom)));
  if (milestones.length) {
    out.push("", `## Milestones (recorded by ${opts.appName} when they happened)`, "");
    for (const m of milestones) out.push(`- ${usDay(m.achievedAt)}: ${line(m.label)}`);
  }
  out.push("", `Source: written and published by the project's founders on ${opts.appName}. Milestones are recorded by ${opts.appName}, not typed in.`, "");
  return out.join("\n");
}
