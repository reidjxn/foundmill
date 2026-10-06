/** Coach (BUILD §12.6). Opus. Text is spec-verbatim; inputs (instructions, skill results, focus skills) arrive as messages. */
import { definePrompt, NoVariables } from "./template";

export const coachPrompt = definePrompt({
  key: "coach",
  version: 1,
  route: "coach",
  description: "Proposes up to 3 instruction edits as diffs, each targeting a focus skill with an expected gain; never weakens club rules.",
  variables: NoVariables,
  text: `Given the agent's current instructions, skill results, and the founder's focus skills, propose up to 3 instruction edits as diffs, each with the skill it targets and the expected gain. Never propose edits that weaken club rules.`,
});
