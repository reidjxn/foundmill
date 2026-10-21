/** Mock worker (Sonnet) and nightly batch generators: structured plans and per-item results from the prompt. */
import type { NightlyBatchOutput, WorkerOutput } from "../schemas";
import { type MockContext, isRecord, sentenceCase, truncate } from "./inputs";
import { inferTaskKind } from "./planCompiler";

const STEPS: Record<string, string[]> = {
  code: ["Read the task goal and what counts as done; list the files in scope", "Write the failing tests for what counts as done", "Implement the smallest change that passes them", "Run typecheck, lint and the full test suite", "Open the PR with a changelog entry and request review"],
  research: ["Define the question and what evidence would settle it", "Gather sources through the gateway and record ids", "Read untrusted content through the quarantined reader", "Summarize findings with citations and confidence", "Hand the summary to the lead with open questions"],
  channel: ["Confirm the audience, budget cap and suppression rules", "Draft creative variants with source-backed claims only", "Submit for policy check and approval where required", "Launch with tracking links or codes", "Measure, report to the Inbox with entities linked"],
  specialist: ["Write down the requirements and quality criteria", "Shortlist suppliers and send structured RFQs", "Extract quotes through the quarantined reader and score them", "Request samples within the approved budget", "Prepare the purchase recommendation for the founder's approval"],
  legal: ["Identify which country's or state's laws apply, and the rules that follow", "Draft the document from the approved template", "Mark every item that needs a human signature or filing", "Prepare the kit for the founder", "Record the compliance deadline in the calendar"],
  finance: ["Pull the books or bank transactions through the connector", "Categorize and reconcile; flag anomalies", "Update the forecast with labeled estimates", "Draft the summary for the Finance overview", "Never initiate a payment; list anything that needs one as a human action"],
  ops: ["Clarify the outcome and who it is for", "Break the work into checkable steps", "Do the work within the limits you were given", "Record what changed and where", "Report back with links to the artifacts"],
};

export function generateWorker(ctx: MockContext): WorkerOutput {
  const task = ctx.getRecord("task");
  const taskText = (task && typeof task.title === "string" ? task.title : undefined) ?? ctx.getString("task", "goal", "instruction", "objective") ?? firstSentence(ctx.lastUser) ?? "Complete the assigned task";
  const taskId = task && typeof task.id === "string" ? task.id : ctx.getString("task_id");
  const kind = (task && typeof task.kind === "string" && task.kind in STEPS ? task.kind : undefined) ?? inferTaskKind(taskText);
  const steps = STEPS[kind] ?? STEPS.ops;
  const picked = (steps as string[]).slice(0, ctx.rng.int(3, 5));
  const artifacts = [taskId ? `branch agent/${taskId}` : "branch agent/<taskId>", `notes/${slug(taskText)}.md`];
  if (kind === "code") artifacts.push("pull request with tests");
  if (kind === "channel") artifacts.push("campaign draft awaiting approval");
  return {
    summary: `Plan for "${truncate(sentenceCase(taskText), 100)}" (${kind}): ${picked.length} steps, each reported as a phase change; no external action or spend without approval.`,
    steps: picked,
    artifacts,
  };
}

export function generateNightlyBatch(ctx: MockContext): NightlyBatchOutput {
  const raw = ctx.getArray<unknown>("items", "jobs", "records", "batch");
  const items = raw.map((r, i) => {
    if (isRecord(r)) {
      const id = typeof r.id === "string" ? r.id : `item-${i + 1}`;
      const label = [r.title, r.name, r.description, r.kind].find((v): v is string => typeof v === "string");
      return { id, result: `Processed${label ? `: ${truncate(label, 80)}` : ""}; no changes to live records, summary written.` };
    }
    return { id: `item-${i + 1}`, result: `Processed: ${truncate(String(r), 80)}.` };
  });
  const job = ctx.getString("job", "job_name", "task", "schedule") ?? firstSentence(ctx.lastUser) ?? "nightly job";
  return {
    summary: `${sentenceCase(job)}: ${items.length} item${items.length === 1 ? "" : "s"} processed in batch mode at the batch price (estimate). Nothing required from the founder.`,
    items,
  };
}

const firstSentence = (s: string): string | undefined => s.replace(/```[\s\S]*?```/g, " ").split(/(?<=[.!?])\s+|\n/).map((x) => x.trim()).find((x) => x.length > 0 && !x.startsWith("{"));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "task";
