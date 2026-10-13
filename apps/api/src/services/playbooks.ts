/**
 * Playbooks (BUILD §11.13, AC-11.13.4): the founder writes a standing rule in plain words, sees it compiled into a trigger,
 * steps, approvals and stop conditions as an editable flow, and turns it on. Nothing here runs a playbook: ingest starts a
 * `playbook` workflow when an enabled playbook's trigger matches an event. Everything is validated against the one
 * contract in packages/shared (`CreatePlaybookParams`), the same one the plan compiler's `create_playbook` action carries.
 */
import { repos, type Playbook } from "@foundmill/db";
import { CompiledPlaybook, CreatePlaybookParams, ValidationError, describePlaybook, readCompiledPlaybook } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { audit } from "../trpc";
import { planContextFor } from "./decide";
import { compilePlan } from "./plans";

export interface PlaybookView {
  id: string;
  name: string;
  sourceText: string;
  departmentId: string | null;
  enabled: boolean;
  lastRunAt: Date | null;
  createdAt: Date;
  /** The rule in the contract's shape; null for a row written before the contract (read its words, recompile to edit). */
  compiled: CompiledPlaybook | null;
  preview: ReturnType<typeof describePlaybook> | null;
}

export function toPlaybookView(row: Playbook): PlaybookView {
  const compiled = readCompiledPlaybook(row.compiled);
  return { id: row.id, name: row.name, sourceText: row.sourceText, departmentId: row.departmentId, enabled: row.enabled, lastRunAt: row.lastRunAt, createdAt: row.createdAt, compiled, preview: compiled ? describePlaybook(compiled) : null };
}

export type CompilePlaybookResult = { ok: true; playbook: CreatePlaybookParams; preview: ReturnType<typeof describePlaybook>; source: "model" | "rules" } | { ok: false; question: string };

/** Compile one sentence into a playbook (the plan compiler's route; the offline rule engine in mock mode). Nothing is saved. */
export async function compilePlaybookText(ctx: BusinessContext, text: string): Promise<CompilePlaybookResult> {
  const planCtx = await planContextFor(ctx);
  const compiled = await compilePlan(ctx.models, text, planCtx);
  const gated = compiled.actions.find((a) => a.type === "request_human_action");
  if (gated) return { ok: false, question: "That includes something only you can do yourself (money, signing, filings, terms), so it cannot run as a playbook. Write the rule without it, or do that part yourself." };
  const action = compiled.actions.find((a) => a.type === "create_playbook");
  if (!action) {
    const ask = compiled.actions.find((a) => a.type === "reply_only");
    const question = typeof ask?.params.question === "string" ? ask.params.question : "";
    return { ok: false, question: question || "That does not read as a standing rule. Say when it should happen and what the team should do, for example: when a lead replies positively, draft a reply and book a call." };
  }
  const parsed = CreatePlaybookParams.safeParse({ ...action.params, source_text: String(action.params.source_text ?? text).slice(0, 2000) });
  if (!parsed.success) return { ok: false, question: "I could not turn that into a complete rule. Say which event starts it and what should happen, for example: when a payment arrives, thank the customer." };
  return { ok: true, playbook: parsed.data, preview: describePlaybook(parsed.data), source: compiled.source };
}

/** Validates a flow the founder edited; the words of the refusal name the first problem. */
export function parseFlow(input: unknown): CompiledPlaybook {
  const parsed = CompiledPlaybook.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(`The playbook is not complete: ${issue ? `${issue.path.join(".") || "playbook"} ${issue.message}` : "check its trigger and steps"}`, { issues: parsed.error.issues.slice(0, 5) });
  }
  return parsed.data;
}

export async function createPlaybook(ctx: BusinessContext, input: { name?: string; sourceText: string; flow: unknown; departmentId?: string | null }): Promise<PlaybookView> {
  const flow = parseFlow(input.flow);
  return ctx.rls(async (tx) => {
    // Created off: the founder turns it on once the flow reads right.
    const row = await repos.playbooks.create(tx, ctx.businessId, { name: input.name?.trim() || input.sourceText.slice(0, 60), sourceText: input.sourceText, departmentId: input.departmentId ?? null, compiled: flow, enabled: false, createdBy: ctx.userId });
    await audit(tx, ctx, { action: "team.playbook.create", target: { kind: "playbook", id: row.id }, details: { trigger: flow.trigger.event, steps: flow.steps.length } });
    return toPlaybookView(row);
  });
}

export async function updatePlaybook(ctx: BusinessContext, input: { id: string; name?: string; flow?: unknown }): Promise<PlaybookView> {
  const flow = input.flow === undefined ? undefined : parseFlow(input.flow);
  return ctx.rls(async (tx) => {
    const row = await repos.playbooks.update(tx, ctx.businessId, input.id, { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(flow ? { compiled: flow } : {}) });
    await audit(tx, ctx, { action: "team.playbook.update", target: { kind: "playbook", id: row.id }, details: { renamed: input.name !== undefined, edited: flow !== undefined } });
    return toPlaybookView(row);
  });
}

export async function setPlaybookEnabled(ctx: BusinessContext, id: string, enabled: boolean): Promise<PlaybookView> {
  return ctx.rls(async (tx) => {
    const current = await repos.playbooks.get(tx, ctx.businessId, id);
    // Only a rule the engine can read can be turned on.
    if (enabled && !readCompiledPlaybook(current.compiled)) throw new ValidationError("This playbook was written in an older format. Write it again to turn it on.");
    const row = await repos.playbooks.setEnabled(tx, ctx.businessId, id, enabled);
    await audit(tx, ctx, { action: enabled ? "team.playbook.enable" : "team.playbook.disable", target: { kind: "playbook", id: row.id }, details: {} });
    return toPlaybookView(row);
  });
}

export async function archivePlaybook(ctx: BusinessContext, id: string): Promise<{ id: string }> {
  return ctx.rls(async (tx) => {
    const row = await repos.playbooks.archive(tx, ctx.businessId, id);
    await audit(tx, ctx, { action: "team.playbook.archive", target: { kind: "playbook", id: row.id }, details: {} });
    return { id: row.id };
  });
}
