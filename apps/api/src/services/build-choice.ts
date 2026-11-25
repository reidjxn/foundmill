/**
 * The founder's answer to the Chief of Staff's build recommendation (founder, Nov 25, 2026; packages/agents
 * `build-choice.ts`). "Build it ourselves" is recorded and the engineering agents build from the plan as before. "Build
 * it with Lovable" spins it up: with Lovable connected, create_project from the plan and set_project_knowledge in the
 * founder's own Lovable workspace, then the project's link; otherwise, or when Lovable refuses, the Build with URL link,
 * which opens Lovable in the founder's own browser with the plan as the first message. The press is the founder's
 * decision for that spend: no further approval is asked for it. A simulated result is reported as simulated, never as done.
 */
import { BUILD_CHOICE_NOTE, buildChoiceIdeaText, lovableBuildUrl, lovablePrompt, lovableProjectLink } from "@foundmill/agents";
import { pmText, repos, type InboxItem } from "@foundmill/db";
import { ConflictError, ForbiddenError, isAdminRole, ValidationError } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { emit } from "../trpc";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";

export const LOVABLE_CONNECTOR = "lovable_mcp";

export type LovableSpinUp =
  | { route: "mcp"; simulated: boolean; projectId: string | null; url: string | null; knowledgeSet: boolean }
  | { route: "link"; url: string; why: "not_connected" | "refused" | "asked"; reason: string | null };

/** Why Lovable did not create the project, in the founder's words, from the fixed code the connector gives (never the vendor's text). */
export function refusedReason(code: string | null): string {
  switch (code) {
    case "insufficient_credits":
      return "your Lovable workspace has no credits left for it";
    case "plan_required":
      return "your Lovable plan does not allow it";
    case "forbidden":
      return "your Lovable sign-in does not allow creating projects";
    case "unauthorized":
      return "the Lovable sign-in has expired, so connect it again in Settings › Integrations";
    case "rate_limited":
      return "Lovable asked us to slow down";
    default:
      return "Lovable could not be reached";
  }
}

/** What the Chief of Staff tells the founder after the press: the link, and exactly what was and was not done. */
export function lovableAnswer(r: LovableSpinUp, fallbackUrl: string): string {
  const open = `[Open Lovable with your plan](${fallbackUrl}): it opens in your own Lovable account with your plan as the first message, and you press send there.`;
  if (r.route === "mcp" && r.simulated) return `This was simulated and not done: no Lovable project was created, because Lovable is not connected for real here. ${open}`;
  if (r.route === "mcp") return `Your Lovable project is started: [open it in Lovable](${r.url ?? fallbackUrl}). I made it from your plan in your own Lovable workspace, and it used your Lovable credits, billed by Lovable.${r.knowledgeSet ? " Lovable also has your positioning and specification to keep in mind on every change." : ""}`;
  if (r.why === "not_connected") return `Lovable is not connected, so I did not create the project for you. ${open} To have me create it next time, connect Lovable in Settings › Integrations.`;
  if (r.why === "asked") return `Creating the Lovable project waits for your yes in the Inbox, as you asked for outside steps. You can also start it yourself: ${open}`;
  return `Lovable did not create the project (${r.reason}), so nothing was made there. ${open}`;
}

export async function planForLovable(ctx: BusinessContext): Promise<{ prompt: string; knowledge: string; name: string }> {
  return ctx.rls(async (tx) => {
    const [inputs, positioning, blocks] = await Promise.all([repos.foundations.inputs(tx, ctx.businessId), repos.positioning.approvedText(tx, ctx.businessId, 4000), repos.product.listBlocks(tx, ctx.businessId)]);
    const specification = blocks.map((b) => ({ section: b.section, text: pmText(b.content) }));
    const ideaText = inputs.idea ? buildChoiceIdeaText(inputs.idea) : ctx.business.name;
    const prompt = lovablePrompt({ businessName: ctx.business.name, ideaText, positioning, specification });
    const knowledge = [`The idea: ${ideaText}`, positioning, ...specification.filter((s) => s.text.trim()).map((s) => `${s.section}: ${s.text.trim()}`)].filter(Boolean).join("\n\n").slice(0, 10_000);
    return { prompt, knowledge, name: ctx.business.name.slice(0, 80) };
  });
}

/** Spins the project up in Lovable: the MCP path when connected, the Build with URL link otherwise. Every outcome is logged with a fixed code, never a secret. */
export async function spinUpLovable(ctx: BusinessContext, plan: { prompt: string; knowledge: string; name: string }): Promise<LovableSpinUp> {
  const link = lovableBuildUrl(plan.prompt);
  const integration = await ctx.rls((tx) => repos.integrations.getByKey(tx, ctx.businessId, LOVABLE_CONNECTOR));
  const chief = await ctx.rls((tx) => repos.agents.chiefOfStaff(tx, ctx.businessId));
  // A mock connection (the golden path, a sample project) runs the mock, whose result is reported as simulated.
  const connected = integration?.status === "connected" || integration?.status === "mock";
  if (!connected || !chief || !ctx.gateway.toolCall) {
    ctx.log.info({ businessId: ctx.businessId, connector: LOVABLE_CONNECTOR, status: integration?.status ?? "none" }, "lovable: not connected, Build with URL link");
    return { route: "link", url: link, why: "not_connected", reason: null };
  }
  const out = await ctx.gateway.toolCall({ businessId: ctx.businessId, agentId: chief.id, connector: LOVABLE_CONNECTOR, tool: "create_project", args: { prompt: plan.prompt, name: plan.name } });
  if (out.outcome !== "allow" || !out.result.ok) {
    const code = out.outcome === "allow" ? ((out.result.error as { details?: { reason?: unknown } } | undefined)?.details?.reason ?? out.result.error?.code ?? null) : null;
    ctx.log.warn({ businessId: ctx.businessId, connector: LOVABLE_CONNECTOR, tool: "create_project", outcome: out.outcome, code: typeof code === "string" ? code : null, reasons: out.outcome === "allow" ? [] : out.reasons }, "lovable: create_project refused, Build with URL link");
    if (out.outcome === "ask") return { route: "link", url: link, why: "asked", reason: null };
    return { route: "link", url: link, why: "refused", reason: refusedReason(typeof code === "string" ? code : null) };
  }
  // The answer is Lovable's, inside the untrusted envelope: only a project id and a Lovable https link are read from it.
  const data = out.result.data as { content?: { structured?: unknown } } | undefined;
  const made = lovableProjectLink(data?.content?.structured);
  const simulated = out.result.simulated === true;
  let knowledgeSet = false;
  if (made.id && plan.knowledge) {
    const k = await ctx.gateway.toolCall({ businessId: ctx.businessId, agentId: chief.id, connector: LOVABLE_CONNECTOR, tool: "set_project_knowledge", args: { project_id: made.id, knowledge: plan.knowledge } }).catch(() => null);
    knowledgeSet = k?.outcome === "allow" && k.result.ok;
    if (!knowledgeSet) ctx.log.warn({ businessId: ctx.businessId, connector: LOVABLE_CONNECTOR, tool: "set_project_knowledge", outcome: k?.outcome ?? "error" }, "lovable: set_project_knowledge did not run");
  }
  ctx.log.info({ businessId: ctx.businessId, connector: LOVABLE_CONNECTOR, tool: "create_project", simulated, hasLink: made.url !== null, knowledgeSet }, "lovable: project created");
  return { route: "mcp", simulated, projectId: made.id, url: made.url, knowledgeSet };
}

export const LOVABLE_STARTING = "Chosen: Build it with Lovable. I'm starting your Lovable project from your plan, and the next note has its link.";

/**
 * The press. The note is answered first, in its own transaction, so two presses (two tabs, two cofounders) create one
 * Lovable project, never two: the second finds the note answered and stops before any call. The outcome, with its link,
 * follows as the Chief of Staff's next note.
 */
export async function decideBuildChoiceNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const option = input.chosenOption;
  const { ours, lovable } = BUILD_CHOICE_NOTE.options;
  if (option !== ours && option !== lovable) throw new ValidationError(`Choose ${BUILD_CHOICE_NOTE.oursLabel} or ${BUILD_CHOICE_NOTE.lovableLabel}.`, { itemId: item.id });
  if (!isAdminRole(ctx.role)) throw new ForbiddenError("Owners, cofounders and admins choose how the project gets built.");

  const summary = option === lovable ? LOVABLE_STARTING : "Chosen: the engineering agents build it from your plan.";
  const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, summary, { params: { build_choice: option }, result: { buildChoice: option === lovable ? "lovable" : "ours" } }));
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  let followUp: InboxItem | null = null;
  if (option === lovable) {
    const plan = await planForLovable(ctx);
    const spun = await spinUpLovable(ctx, plan);
    const body = lovableAnswer(spun, lovableBuildUrl(plan.prompt));
    const from = item.fromAgentId;
    followUp = await ctx.rls(async (tx) => {
      const note = await repos.inbox.createItem(tx, ctx.businessId, { type: "update", from_agent_id: from, subject: spun.route === "mcp" && !spun.simulated ? "Your Lovable project is started" : "Build it with Lovable", body_md: body, status_strip: [], exhibit: { kind: "none", spec_ref: null }, decision: null, blocks_continue: false, source_event_ids: [], entity_ids: [] }, { state: "unread" });
      await emit(tx, ctx, { type: "inbox.item_created", ...(from ? { actor: { kind: "agent" as const, id: from } } : {}), payload: { inboxItemId: note.id, type: note.type, fromAgentId: from, subject: note.subject, blocksContinue: false, sourceEventIds: [], cost: null } });
      return note;
    });
  }
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp };
}
