// @vitest-environment happy-dom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@foundmill/dugout";
import { VERSION_ACTION_LABELS, versionActionLabel, type IdeaLike, type IdeaVersionLike } from "../ideate/concepts";
import { ForkDialog, HistoryDialog } from "../ideate/dialogs";

/** "More like this" makes a variant; the founder never reads the developer word "fork" (A14, review F20). */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function version(n: number, action: string): IdeaVersionLike {
  return { id: `v${n}`, version: n, title: "Patchwise", pitch: "Patch-test kits by post.", attributes: { market_size: { value: 12 } }, starsCurrent: 3, starsPotential: 4, research: null, parentVersionId: n > 1 ? `v${n - 1}` : null, action, createdAt: "2026-10-09T10:00:00Z" };
}
const idea: IdeaLike = { id: A, title: "Patchwise", pitch: "Patch-test kits by post.", archetype: null, current: version(2, "forked") };

describe("variant wording", () => {
  it("labels the version action 'Variant made', never 'Forked'", () => {
    expect(versionActionLabel("forked")).toBe("Variant made");
    expect(Object.values(VERSION_ACTION_LABELS).some((w) => /fork/i.test(w))).toBe(false);
  });

  it("explains a variant without the word 'Forked'", () => {
    render(
      <TooltipProvider>
        <ForkDialog idea={idea} open onOpenChange={() => undefined} onFork={() => undefined} />
      </TooltipProvider>,
    );
    const dialog = screen.getByTestId("fork-dialog");
    expect(within(dialog).getByText("A variant is a new card with its own history; the original's history links to it.")).toBeTruthy();
    expect(dialog.textContent).not.toMatch(/fork/i);
  });

  it("reads the history's version rows and lineage as 'Variant made', 'Variant of' and 'Variant:'", () => {
    const titles: Record<string, string> = { [B]: "Patchwise Pro", [C]: "Patchwise Lite" };
    render(
      <TooltipProvider>
        <HistoryDialog idea={idea} versions={[version(1, "generated"), version(2, "forked")]} open onOpenChange={() => undefined} lineage={{ mergedFrom: [], mergedInto: null, forkedFrom: B, forkedTo: C }} titleOf={(id) => titles[id]} />
      </TooltipProvider>,
    );
    const history = screen.getByTestId("history-dialog");
    expect(within(history).getByText("Variant made", { exact: true })).toBeTruthy();
    const lineage = within(history).getByTestId("lineage");
    expect(lineage.textContent).toContain("Variant of Patchwise Pro");
    expect(lineage.textContent).toContain("Variant: Patchwise Lite");
    expect(history.textContent).not.toMatch(/forked/i);
  });
});
