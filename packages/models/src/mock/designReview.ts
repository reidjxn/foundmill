/**
 * Mock design reviewer (route `designReview`, item 13). It cannot see pixels, so it reviews only what the request
 * describes in numbers: for each screenshot the request lists with a page description (`screenshots[].description`), it
 * runs the shared design lint (`lintPageDescription`) and returns those findings as fixes, most serious first. A
 * screenshot without a description, or a request with none, gets no fix and no word about how it looks: the mock never
 * judges a page it was not shown.
 */
import { DESIGN_PRINCIPLES, lintPageDescription, PageDescription, type DesignFinding } from "@foundmill/shared";
import { DESIGN_REVIEW_MAX_FIXES, type DesignReviewOutput } from "../design-review-schema";
import type { MockContext } from "./inputs";

interface ShotInput {
  id?: unknown;
  description?: unknown;
}

const SEVERITY = { high: 0, medium: 1, low: 2 } as const;

export function generateDesignReview(ctx: MockContext): DesignReviewOutput {
  const shots = ctx.getArray<ShotInput>("screenshots");
  const found: { finding: DesignFinding; shot: string }[] = [];
  const unreadable: DesignReviewOutput["unreadable"] = [];
  for (const shot of shots) {
    const id = typeof shot.id === "string" ? shot.id : null;
    if (!id) continue;
    const parsed = PageDescription.safeParse(shot.description);
    if (!parsed.success) {
      unreadable.push({ shot: id, why: "No page description came with this screenshot, so the mock reviewer cannot judge it." });
      continue;
    }
    for (const finding of lintPageDescription(parsed.data)) found.push({ finding, shot: id });
  }
  // One fix per problem: the same finding at both widths is one fix for "both".
  const merged = new Map<string, { finding: DesignFinding; shots: string[]; viewports: Set<string> }>();
  for (const { finding, shot } of found) {
    const key = `${finding.page}|${finding.principle}|${finding.element}`;
    const entry = merged.get(key) ?? { finding, shots: [], viewports: new Set<string>() };
    entry.shots.push(shot);
    entry.viewports.add(finding.viewport);
    merged.set(key, entry);
  }
  const fixes = [...merged.values()]
    .sort((a, b) => SEVERITY[a.finding.severity] - SEVERITY[b.finding.severity] || DESIGN_PRINCIPLES.indexOf(a.finding.principle) - DESIGN_PRINCIPLES.indexOf(b.finding.principle))
    .slice(0, DESIGN_REVIEW_MAX_FIXES)
    .map(({ finding, shots: ids, viewports }) => ({
      page: finding.page,
      viewport: viewports.size > 1 ? ("both" as const) : finding.viewport,
      element: finding.element.slice(0, 200),
      problem: finding.problem.slice(0, 300),
      fix: finding.fix.slice(0, 300),
      principle: finding.principle,
      severity: finding.severity,
      shots: ids.slice(0, 8),
    }));
  return { fixes, unreadable: unreadable.slice(0, 8) };
}
