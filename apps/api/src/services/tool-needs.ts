/**
 * The founder's answer to the tool scout's recommendation (founder, Nov 22, 2026), decided in-process like the page
 * note: "Yes" records the pick as chosen and puts one task on the Chief of Staff's board to bring it in once the
 * founder has done their step; "Not now" keeps the question away until the day to ask again. Nothing here signs up
 * for a vendor, accepts terms, pays or connects anything: those are the founder's steps, outside this note.
 */
import { repos, type InboxItem } from "@foundmill/db";
import { ConflictError, ForbiddenError, isAdminRole, TOOL_CATEGORY_LABELS, TOOL_NEED_ASK_AGAIN_DAYS, TOOL_PICK_NOTE, ValidationError, toolPickCategory } from "@foundmill/shared";
import type { BusinessContext } from "../trpc";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";

export async function decideToolPickNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const category = toolPickCategory(item.decision);
  const option = input.chosenOption;
  if (!category || (option !== TOOL_PICK_NOTE.options.yes && option !== TOOL_PICK_NOTE.options.notNow)) throw new ValidationError(`Choose yes or ${TOOL_PICK_NOTE.notNowLabel}.`, { itemId: item.id });
  if (!isAdminRole(ctx.role)) throw new ForbiddenError("Owners, cofounders and admins choose the project's tools.");
  const yes = option === TOOL_PICK_NOTE.options.yes;
  const answered = await ctx.rls(async (tx) => {
    const need = await repos.toolNeeds.get(tx, ctx.businessId, category);
    const name = need?.pick?.name ?? "the tool";
    const summary = yes ? `Chosen for ${TOOL_CATEGORY_LABELS[category]}: ${name}.` : `Not now for ${TOOL_CATEGORY_LABELS[category]}. The team asks again in about ${TOOL_NEED_ASK_AGAIN_DAYS} days.`;
    const note = await answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, summary, { params: { tool_category: category, tool_option: option }, result: { toolCategory: category, toolOption: option } });
    if (!note) return null;
    if (yes && need?.pick) {
      const own = need.pick.route === "foundmill";
      await repos.tasks.create(tx, ctx.businessId, {
        kind: "ops",
        title: `Bring ${name} into the project`.slice(0, 200),
        goalMd: [
          `The founder chose ${name} for ${TOOL_CATEGORY_LABELS[category]}. ${need.pick.why}`,
          own ? "It is Foundmill's own: draft the setup from what the founder already told the team, and hand it to the founder to check before anything goes live." : `The founder's step: ${need.pick.founderSteps} Until it shows as connected, prepare what does not need it. Once it does, set it up in its test mode first; for a software project the engineers add it on a branch with tests, as a pull request the founder approves. A result from a test mode is never reported as a real outcome.`,
          "Never sign up, accept terms, pay or enter a key for the founder.",
        ].join("\n\n"),
        acceptance: own ? ["The setup is drafted from the project's own records", "The founder has it to check; nothing is live without their yes"] : ["Nothing was set up before the founder connected it", "It works in the vendor's test mode, shown by a tool result", "The founder was told what is live and what is still test"],
        assigneeAgentId: item.fromAgentId,
        status: "ready",
        currency: ctx.business.currency,
      });
    }
    return note;
  });
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  // The scout's memory is the services' to write (0154): the answer is stored on the service connection.
  await repos.toolNeeds.decide(ctx.db, ctx.businessId, category, yes ? "accepted" : "not_now");
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
}
