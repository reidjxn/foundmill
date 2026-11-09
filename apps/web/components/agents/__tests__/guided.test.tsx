// @vitest-environment happy-dom
/**
 * The guided layer on the agent profile (docs/UX_AUDIT_AND_PLAN.md §7.15): the Training tab's three-step Explainer
 * (C5), the Skills footer with Tested and Proven as defined words (C3) and the "Why this matters" line that renders
 * only while guidance is on, and the "About Skills" tip.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Explainer, GuidanceProvider, Panel, TooltipProvider } from "@foundmill/dugout";
import { termsWithGlossary } from "@foundmill/shared/terms";
import { SKILLS_HELP, SkillsFooter } from "../OverviewTab";
import { AGENT_TRAINING_EXPLAINER } from "../TrainingTab";

const TERMS = termsWithGlossary(null);

describe("Training explainer (C5)", () => {
  it("says what training is for, the three steps and what to watch, and never renders with guidance off", () => {
    expect(AGENT_TRAINING_EXPLAINER.screenId).toBe("agent-training");
    expect(AGENT_TRAINING_EXPLAINER.purpose).toBe("Training tries new instructions on practice tests; nothing goes live until you promote it.");
    expect(AGENT_TRAINING_EXPLAINER.action).toBe("1 Edit the instructions · 2 Train (2–5 minutes) · 3 Promote if the scores improved");
    expect(AGENT_TRAINING_EXPLAINER.watchFor).toBe("A drop of more than one point is highlighted; the Coach explains it.");
    const { rerender } = render(<Explainer {...AGENT_TRAINING_EXPLAINER} />);
    // Without a shell the Explainer draws the one button in place; the three steps open behind it.
    const button = document.querySelector("[data-explainer='agent-training']") as HTMLElement;
    expect(button.textContent).toContain("Explain this page");
    expect(screen.queryByText(/1 Edit the instructions/)).toBeNull();
    fireEvent.click(button);
    expect(screen.getByTestId("explain-page-panel").textContent).toContain("1 Edit the instructions");
    rerender(
      <GuidanceProvider value={{ guidance: "off" }}>
        <Explainer {...AGENT_TRAINING_EXPLAINER} />
      </GuidanceProvider>,
    );
    expect(document.querySelector("[data-explainer='agent-training']")).toBeNull();
  });
});

describe("Skills footer and tip (C3)", () => {
  it("defines Tested and Proven from the definitions map, keeps the scores sentence, and adds why it matters only while guided", () => {
    expect(TERMS.tested?.short).toMatch(/practice tests/);
    expect(TERMS.proven?.short).toMatch(/real work/);
    const { rerender } = render(
      <TooltipProvider>
        <GuidanceProvider value={{ terms: TERMS }}>
          <SkillsFooter guided />
        </GuidanceProvider>
      </TooltipProvider>,
    );
    const footer = screen.getByTestId("skills-footer");
    expect(footer.textContent).toContain("Scores 1–20.");
    expect(footer.textContent).toContain("'Tested' is the result on practice tests".replace(/'/g, ""));
    expect(footer.querySelector("[data-term='tested']")?.className).toContain("term-link");
    expect(footer.querySelector("[data-term='proven']")?.className).toContain("term-link");
    expect(screen.getByTestId("skills-why").textContent).toContain("Higher skills mean fewer failed tasks");
    rerender(
      <TooltipProvider>
        <GuidanceProvider value={{ guidance: "off", terms: TERMS }}>
          <SkillsFooter guided={false} />
        </GuidanceProvider>
      </TooltipProvider>,
    );
    // Guidance off: the words stay as plain text (no underline) and the tutoring line is gone; the scores sentence stays.
    expect(screen.queryByTestId("skills-why")).toBeNull();
    expect(screen.getByTestId("skills-footer").textContent).toContain("Scores 1–20.");
    expect(screen.getByTestId("skills-footer").querySelector("[data-term='tested']")?.getAttribute("data-guided")).toBe("off");
  });

  it("the Skills panel carries an About Skills tip while guided, none when guidance is off", () => {
    const { rerender } = render(
      <TooltipProvider>
        <GuidanceProvider value={{ terms: TERMS }}>
          <Panel title="Skills" help={SKILLS_HELP} helpLearn="team/agents">
            body
          </Panel>
        </GuidanceProvider>
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "About Skills" })).toBeTruthy();
    expect(SKILLS_HELP).toContain("Poor, Average, Good or Excellent");
    rerender(
      <TooltipProvider>
        <GuidanceProvider value={{ guidance: "off", terms: TERMS }}>
          <Panel title="Skills" help={SKILLS_HELP} helpLearn="team/agents">
            body
          </Panel>
        </GuidanceProvider>
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "About Skills" })).toBeNull();
  });
});
