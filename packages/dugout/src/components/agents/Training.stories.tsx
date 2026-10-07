import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ModelKey } from "@foundmill/shared";
import { InstructionsEditor, type InstructionComment } from "./InstructionsEditor";
import { MOCK_COACH_EXPLANATION, mockInstructionVersions, mockModelOptions, mockTrainingResults } from "./mock";
import { ModelPicker } from "./ModelPicker";
import { TrainingResults } from "./TrainingResults";
import type { AgentInstructions } from "./types";

const meta = {
  title: "Agents/Training",
  parameters: { layout: "padded" },
} satisfies Meta;
export default meta;
type Story = StoryObj;

function ResultsDemo() {
  const [state, setState] = useState<string | null>(null);
  return (
    <div className="w-[1100px]">
      <TrainingResults results={mockTrainingResults()} coachExplanation={MOCK_COACH_EXPLANATION} candidateVersion={5} liveVersion={4} cost={{ amountMinor: 184, currency: "EUR" }} durationMs={214_000} onPromote={() => setState("Promoted v5. Seven-day watch started.")} onDiscard={() => setState("Discarded the draft. v4 stays live.")} />
      {state ? <p className="mt-2 text-small text-secondary">{state}</p> : null}
    </div>
  );
}

/** Old → new per skill with arrows; drops of more than one point are highlighted; the Coach explains; Promote or Discard. */
export const Results: Story = { render: () => <ResultsDemo /> };

function EditorDemo() {
  const versions = mockInstructionVersions();
  const live = versions.find((v) => v.state === "live")!.instructions;
  const [value, setValue] = useState<AgentInstructions>({
    ...live,
    goals: [...live.goals, "Answer every review comment within one cycle."],
    rules: [...live.rules.slice(0, 2), "You may merge schema changes without asking when tests pass.", ...live.rules.slice(2)],
    tone: "Plain and specific. Short sentences. No exclamation marks. Warm with customers.",
  });
  const [comments, setComments] = useState<InstructionComment[]>([{ id: "c1", author: "Coach", at: "2026-10-01T15:30:00Z", text: "Tests-first lifted Testing from 10 to 16 on the last run." }]);
  return (
    <div className="w-[960px]">
      <InstructionsEditor
        value={value}
        onChange={setValue}
        versions={versions}
        violations={[{ section: "rules", index: 2, reason: "schema changes always ask the founder first" }]}
        comments={comments}
        onComment={(text) => setComments((c) => [...c, { id: `c${c.length + 1}`, author: "Founder", at: new Date().toISOString(), text }])}
      />
    </div>
  );
}

/** Structured editor with a draft that differs from the live version; switch to Diff to see the line diff; one rule is flagged by the club-rule detector. */
export const InstructionsWithDiff: Story = { render: () => <EditorDemo /> };

export const InstructionsDiffMode: Story = {
  render: () => {
    const versions = mockInstructionVersions();
    const live = versions.find((v) => v.state === "live")!.instructions;
    return (
      <div className="w-[960px]">
        <InstructionsEditor value={{ ...live, playbook: [...live.playbook, "Attach the Playwright trace to the pull request."] }} onChange={() => {}} versions={versions} defaultMode="diff" />
      </div>
    );
  },
};

function ModelDemo() {
  const [model, setModel] = useState<ModelKey>("sonnet");
  return (
    <div className="grid w-[1100px] grid-cols-2 gap-6">
      <div className="flex flex-col gap-2">
        <span className="t-label">Frontend engineer</span>
        <ModelPicker options={mockModelOptions(model)} value={model} onChange={setModel} />
        <p className="text-small text-secondary">Changing the model opens ApplyScopeDialog and runs the preview tests on the candidate.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="t-label">Chief of Staff (Opus)</span>
        <ModelPicker options={mockModelOptions("opus", { chiefOfStaff: true })} value="opus" onChange={() => {}} />
        <span className="t-label mt-4">Inbox Composer (locked)</span>
        <ModelPicker options={mockModelOptions("opus", { lockedToOpus: true })} value="opus" onChange={() => {}} />
      </div>
    </div>
  );
}

export const ModelSelection: Story = { render: () => <ModelDemo /> };
