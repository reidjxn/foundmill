/**
 * The founder's answer to the tool scout's recommendation (founder, Nov 22, 2026), decided in-process like the page
 * note: "Yes" records the pick as chosen and puts one task on the Chief of Staff's board to bring it in once the
 * founder has done their step; "Not now" keeps the question away until the day to ask again. Nothing here signs up
 * for a vendor, accepts terms, pays or connects anything: those are the founder's steps, outside this note.
 */
import { repos, type InboxItem } from "@foundmill/db";
import { BROWSER_SIGN_IN, browserKeepSite, browserSignInExpiry, ConflictError, ForbiddenError, isAdminRole, TOOL_CATEGORY_LABELS, type ToolCategory, TOOL_NEED_ASK_AGAIN_DAYS, TOOL_PICK_NOTE, ValidationError, toolPickCategory } from "@foundmill/shared";
import { browserConnectorKey, browserSite, catalogTool } from "@foundmill/connectors";
import type { BusinessContext } from "../trpc";
import { answerNote } from "./answer-note";
import type { DecideItemResult } from "./decide";

/**
 * The lead whose department owns a kind of tool: a setup the team does in a website (the hosted browser) is that
 * department's task. Absent, or not hired: the agent who recommended it.
 */
const CATEGORY_OWNER: Partial<Record<ToolCategory, string>> = {
  payments: "finance_lead",
  subscriptions: "finance_lead",
  invoicing_accounting: "finance_lead",
  kyc_identity: "legal_lead",
  aml_screening: "legal_lead",
  e_signature: "legal_lead",
  patents_ip: "legal_lead",
  email: "distribution_strategist",
  sms: "distribution_strategist",
  forms: "distribution_strategist",
  analytics: "product_lead",
  help_desk: "operations_lead",
  shipping: "operations_lead",
  inventory: "operations_lead",
};

/** What a setup in a website asks of the team (Part D, D3): done stated first, one change at a time, checked by reading back. */
function browserSetupGoal(name: string, category: ToolCategory, why: string, connectorKey: string | undefined): string {
  return [
    `The founder chose ${name} for ${TOOL_CATEGORY_LABELS[category]}. ${why}`,
    `The founder signs up with ${name} and signs in once in Settings › Integrations. Until it shows as connected, prepare what does not need it.`,
    `Once it is connected, set it up in its website through the hosted browser (${connectorKey ? `the ${connectorKey} tools` : "the browser tools"}), with the browser_work skill:`,
    "1. Before the first change, write down in this task what done looks like on the site: each setting and record you will set, with its value.",
    "2. Read the page before every change, make one change at a time, and read the page again to check it.",
    "3. Ask the founder (request_founder) for a sign-in, a code, a bot check, or any choice that costs money. Never guess at one.",
    "4. Save a report that lists each thing that was set and, for each, whether reading the page back showed it. Anything you could not check is reported as not verified.",
    "Never sign up, accept terms, pay or enter a password, a card or a code for the founder.",
  ].join("\n\n");
}

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
    if (yes && need?.pick?.route === "browser") {
      const ownerKey = CATEGORY_OWNER[category];
      const owner = ownerKey ? (await repos.agents.list(tx, ctx.businessId, { agentType: ownerKey, limit: 1 })).items[0] : undefined;
      const connectorKey = need.pick.catalogKey ? catalogTool(need.pick.catalogKey)?.connectorKey : undefined;
      await repos.tasks.create(tx, ctx.businessId, {
        kind: "ops",
        title: `Set up ${name} in its website`.slice(0, 200),
        goalMd: browserSetupGoal(name, category, need.pick.why, connectorKey),
        acceptance: ["What done looks like was written down before the first change", "Each setting was checked by reading the page back", "The report lists what was set and what was verified, and says plainly what was not verified", "Nothing was paid, agreed to or sent without the founder's own press"],
        assigneeAgentId: owner?.id ?? item.fromAgentId,
        status: "ready",
        currency: ctx.business.currency,
      });
    } else if (yes && need?.pick) {
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

/**
 * The founder's answer to "Keep your saved sign-in to <site>?" (a quiet saved sign-in, founder, Nov 22, 2026): Keep it
 * gives the sign-in another 30 days; Let it go leaves the date as it is, and the nightly scan deletes it on the day.
 */
export async function decideBrowserKeepNote(ctx: BusinessContext, item: InboxItem, input: { chosenOption: string | null; freeText: string | null }): Promise<DecideItemResult> {
  const siteKey = browserKeepSite(item.decision);
  const option = input.chosenOption;
  if (!siteKey || (option !== BROWSER_SIGN_IN.options.keep && option !== BROWSER_SIGN_IN.options.letGo)) throw new ValidationError("Choose Keep it or Let it go.", { itemId: item.id });
  if (!isAdminRole(ctx.role)) throw new ForbiddenError("Owners, cofounders and admins decide about the project's saved sign-ins.");
  const keep = option === BROWSER_SIGN_IN.options.keep;
  const name = browserSite(siteKey)?.name ?? siteKey;
  const answered = await ctx.rls((tx) => answerNote(tx, ctx, item.id, option, input.freeText, item.fromAgentId, keep ? `Kept the saved sign-in to ${name} for another ${BROWSER_SIGN_IN.quietDays} days.` : `The saved sign-in to ${name} will be deleted on the day.`, { params: { site: siteKey, option }, result: { site: siteKey, option } }));
  if (!answered) throw new ConflictError("This note was answered a moment ago.", { itemId: item.id, code: "already_decided" });
  if (keep) {
    // Credentials are the services' to write: the new date is set on the service connection, sealed value untouched.
    const row = await repos.integrations.getByKey(ctx.db, ctx.businessId, browserConnectorKey(siteKey));
    const credential = row ? await repos.credentials.latest(ctx.db, ctx.businessId, row.id) : null;
    if (credential) await repos.credentials.setExpiry(ctx.db, ctx.businessId, credential.meta.id, browserSignInExpiry(new Date()));
  }
  return { item: answered.item, decision: answered.decision, plan: answered.plan, evaluations: [], requiresConfirmation: false, executed: [answered.actionId], deferred: [], denied: [], dispatch: null, followUp: null };
}
