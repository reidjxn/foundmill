/**
 * The tool scout's note to the founder (founder, Nov 22, 2026): the pick, why it fits, why now, what it costs
 * (Estimate), the alternatives in one line each, and what the founder has to do.
 *
 * The agent supplies the comparison; this file writes the note. What the founder must do is fixed here by the route
 * the tool comes in by, never taken from the agent's text: signing up, accepting terms and paying are always the
 * founder's steps, and a vendor's web page that says otherwise changes nothing. A pick named in the catalog takes the
 * catalog's route; one that is not says "not yet checked by Foundmill".
 */
import { z } from "zod";
import { TOOL_CATEGORIES, TOOL_CATEGORY_LABELS, TOOL_PICK_NOTE, TOOL_ROUTES, type ToolRoute } from "@foundmill/shared";
import { APP_NAME } from "@foundmill/config";
import { catalogToolNamed } from "./tool-catalog";

/** What a recommendation says about a vendor that is not in the catalog. */
export const TOOL_UNCHECKED_LINE = `This one is not yet checked by ${APP_NAME}.`;

const Line = (max: number) => z.string().trim().min(1).max(max);

export const RecommendToolArgs = z.object({
  category: z.enum(TOOL_CATEGORIES),
  pick: z.object({
    name: Line(80),
    /** How it comes in, for a vendor that is not in the catalog (a catalog entry's own route wins). */
    route: z.enum(TOOL_ROUTES).exclude(["foundmill"]).default("link"),
    /** Why it fits this project, one or two sentences. */
    why: Line(600),
    /** Why the project needs it now and not later, one sentence. */
    whyNow: Line(400),
    /** The cost for this project in words ("$29 a month", "2.9% + 30¢ per payment"); the note labels it Estimate. Leave out for Foundmill's own. */
    cost: Line(120).optional(),
  }),
  /** The two options not picked, one line each on how they differ. None for Foundmill's own. */
  alternatives: z.array(z.object({ name: Line(80), line: Line(300) })).max(2).default([]),
  /** What the comparison cites: the vendors' own pages and anything a regulator says. */
  sources: z.array(z.object({ url: z.url({ protocol: /^https?$/ }), title: Line(300) })).max(20).default([]),
});
export type RecommendToolArgs = z.output<typeof RecommendToolArgs>;

export interface ToolRecommendationNote {
  subject: string;
  bodyMd: string;
  options: { id: string; label: string; recommended: boolean; consequence: string; because?: string; cost_minor: number; reversible: boolean }[];
  key: string;
  pick: { name: string; catalogKey?: string; route: ToolRoute; why: string; whyNow: string; cost: string; founderSteps: string };
}

/** What the founder does, by route. Written here, never by the agent. */
export function founderSteps(route: ToolRoute, name: string): string {
  if (route === "foundmill") return "Nothing to sign up for and nothing to pay. Say yes, and I set it up for you to check before anything goes live.";
  const signUp = `You sign up with ${name} and accept its terms yourself: that step is always yours.`;
  if (route === "remote_mcp") return `${signUp} Then connect it in Settings › Integrations with ${name}'s own sign-in, and I set it up. ${name} bills you directly.`;
  if (route === "api_key") return `${signUp} Then add your key in Settings › Integrations, and I set it up in its test mode first. ${name} bills you directly.`;
  return `${signUp} Then send me the link, and I put it on your project's page.`;
}

/** The problems that stop a recommendation, in words the agent can act on (empty when it can be sent). */
export function recommendationProblems(args: RecommendToolArgs): string[] {
  const entry = catalogToolNamed(args.pick.name, args.category);
  if (entry?.route === "foundmill") return [];
  const problems: string[] = [];
  if (args.alternatives.length !== 2) problems.push("name the two alternatives you compared, one line each");
  if (args.sources.length === 0) problems.push("cite your sources: the vendor's own pages you read");
  if (!args.pick.cost) problems.push("say what it costs for this project; the note labels it Estimate");
  if (args.alternatives.some((a) => a.name.toLowerCase() === args.pick.name.toLowerCase())) problems.push("an alternative cannot be the pick");
  return problems;
}

export function toolRecommendationNote(args: RecommendToolArgs): ToolRecommendationNote {
  const label = TOOL_CATEGORY_LABELS[args.category];
  const entry = catalogToolNamed(args.pick.name, args.category);
  const name = entry?.name ?? args.pick.name;
  const route: ToolRoute = entry?.route ?? args.pick.route;
  const own = route === "foundmill";
  const cost = own ? "Free on every plan." : `About ${args.pick.cost ?? "a price I could not confirm"} (Estimate).`;
  const steps = founderSteps(route, name);
  const body = [
    `For ${label}, I suggest **${name}**. ${args.pick.why}`,
    `**Why now:** ${args.pick.whyNow}`,
    `**What it costs:** ${cost}${entry ? "" : ` ${TOOL_UNCHECKED_LINE}`}`,
    ...(args.alternatives.length ? [`**The other options I looked at:**\n${args.alternatives.map((a) => `- ${a.name}: ${a.line}`).join("\n")}`] : []),
    `**What you do:** ${steps}`,
    ...(args.sources.length ? [`**Sources:** ${args.sources.map((s) => `[${s.title}](${s.url})`).join(", ")}`] : []),
  ].join("\n\n");
  return {
    subject: `A tool for ${label}: ${name}`.slice(0, 80),
    bodyMd: body,
    key: `${TOOL_PICK_NOTE.keyPrefix}${args.category}`,
    options: [
      { id: TOOL_PICK_NOTE.options.yes, label: (own ? "Yes, set it up" : `Yes, I'll sign up with ${name}`).slice(0, 120), recommended: true, consequence: own ? "The team drafts the setup for you to check." : "The team sets it up once you have connected it.", because: args.pick.whyNow.slice(0, 400), cost_minor: 0, reversible: true },
      { id: TOOL_PICK_NOTE.options.notNow, label: TOOL_PICK_NOTE.notNowLabel, recommended: false, consequence: "Nothing changes. The team asks again in about a month, or sooner if you say so.", cost_minor: 0, reversible: true },
    ],
    pick: { name, ...(entry ? { catalogKey: entry.key } : {}), route, why: args.pick.why, whyNow: args.pick.whyNow, cost, founderSteps: steps },
  };
}
