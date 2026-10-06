/** Skill grader (BUILD §12.5). Opus. Text is spec-verbatim; no variables (rubric, output and check results arrive as messages). */
import { definePrompt, NoVariables } from "./template";

export const skillGraderPrompt = definePrompt({
  key: "skill_grader",
  version: 1,
  route: "skillGrader",
  description: "Scores an agent output 0-1 per rubric line; deterministic check results are authoritative.",
  variables: NoVariables,
  text: `Grade the agent output against the rubric. Score 0-1 with one-sentence justification per rubric line. Deterministic check results are authoritative; do not override them. Return JSON {score, lines:[{criterion, score, reason}]}.`,
});
