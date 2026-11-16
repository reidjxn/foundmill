/**
 * The project's positioning notes in the console (WP-08 T1; Product › Vision; packages/db `repos.positioning`).
 *
 * - `positioning.get` (Product read): the approved copy, the copy waiting for the founders, and the text prompts read.
 * - `positioning.save` (Product write): a member's edit becomes the waiting copy (never read by a prompt).
 * - `positioning.approve` (an owner or an admin with Product write): the founder's own press; the copy prompts read from
 *   now on, its version up by one, with an audit row and `positioning.approved` through the outbox.
 * - `positioning.requestDraft` (Product write): the Product lead's first draft from the founder's own words, for a
 *   project that has neither copy (one in-process call on the `projectPage` route, booked like the page draft).
 *
 * The foundations columns have no client write policy (0019 rule, kept by 0117), so every write here runs on the
 * service connection after the procedure's own section and role checks.
 */
import { POSITIONING_USAGE_KIND, runPositioningDraft } from "@foundmill/agents";
import { repos } from "@foundmill/db";
import { ValidationError, positioningFromInput, positioningProblems, renderPositioning, type PositioningNotes, type PositioningNotesInput } from "@foundmill/shared";
import type { z } from "zod";
import { audit, emit, type BusinessContext } from "../trpc";

export interface PositioningView {
  approved: PositioningNotes | null;
  draft: PositioningNotes | null;
  /** What prompts receive: the approved copy rendered, or empty until one is approved. */
  text: string;
  /** What keeps the waiting copy (else the approved one) from being approved. */
  problems: string[];
  canApprove: boolean;
}

export const POSITIONING_NONE_MESSAGE = "There is nothing to approve yet. Ask the team to draft it first.";
export const POSITIONING_ALREADY_MESSAGE = "This project already has positioning notes. Change them here instead.";

const today = (): string => new Date().toISOString().slice(0, 10);

export async function positioningView(ctx: BusinessContext): Promise<PositioningView> {
  const copies = await repos.positioning.get(ctx.db, ctx.businessId);
  const current = copies.draft ?? copies.approved;
  return {
    approved: copies.approved,
    draft: copies.draft,
    text: copies.approved ? renderPositioning(copies.approved) : "",
    problems: current ? positioningProblems(current) : [],
    canApprove: ctx.role === "owner" || ctx.role === "admin",
  };
}

type NotesIn = z.output<typeof PositioningNotesInput>;

export async function savePositioning(ctx: BusinessContext, input: { notes: NotesIn }): Promise<PositioningView> {
  const copies = await repos.positioning.get(ctx.db, ctx.businessId);
  const notes = positioningFromInput(input.notes, copies.approved, today());
  await ctx.db.transaction(async (tx) => {
    const out = await repos.positioning.writeDraft(tx, ctx.businessId, { notes, agentId: null, note: false });
    if (!out.written) throw new ValidationError(POSITIONING_NONE_MESSAGE);
    await audit(tx, ctx, { action: "positioning.edited", target: { kind: "business", id: ctx.businessId }, details: { basedOn: copies.approved?.version ?? null } });
  });
  return positioningView(ctx);
}

export async function approvePositioning(ctx: BusinessContext, input: { notes: NotesIn }): Promise<PositioningView> {
  const copies = await repos.positioning.get(ctx.db, ctx.businessId);
  const notes = positioningFromInput(input.notes, copies.approved, today());
  const problems = positioningProblems(notes);
  if (problems.length) throw new ValidationError(problems[0]!, { problems });
  await ctx.db.transaction(async (tx) => {
    const out = await repos.positioning.approve(tx, ctx.businessId, { notes, userId: ctx.userId });
    if (!out) throw new ValidationError(POSITIONING_NONE_MESSAGE);
    await audit(tx, ctx, { action: "positioning.approved", target: { kind: "business", id: ctx.businessId }, details: { version: out.notes.version, sectionsChanged: out.sectionsChanged } });
    await emit(tx, ctx, { type: "positioning.approved", payload: { version: out.notes.version, sectionsChanged: out.sectionsChanged } });
  });
  return positioningView(ctx);
}

export async function requestPositioningDraft(ctx: BusinessContext): Promise<PositioningView> {
  const copies = await repos.positioning.get(ctx.db, ctx.businessId);
  if (copies.approved || copies.draft) throw new ValidationError(POSITIONING_ALREADY_MESSAGE);
  const inputs = await repos.foundations.inputs(ctx.db, ctx.businessId);
  const drafted = await runPositioningDraft(ctx.models, inputs, { attribution: { businessId: ctx.businessId, agentId: inputs.authorAgentId ?? undefined, kind: POSITIONING_USAGE_KIND } });
  await ctx.db.transaction(async (tx) => {
    const out = await repos.positioning.writeDraft(tx, ctx.businessId, { notes: drafted.notes, agentId: inputs.authorAgentId, note: false, onlyIfEmpty: true });
    if (out.written) await audit(tx, ctx, { action: "positioning.drafted", target: { kind: "business", id: ctx.businessId }, details: { source: drafted.source, costMinor: drafted.costMinor, costLabel: "Estimate" } });
  });
  return positioningView(ctx);
}

