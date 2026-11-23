/**
 * "Explain this page" copy for every inline area tab and the screens a first-timer lands on (WP-10 T3). Keyed
 * `"<module>/<slug>"` for a department tab, else `"milestones"`, `"crm"`, `"inbox"`, `"home"`, `"calls"` and
 * `"settings/<tab>"`. Three short sentences each. A screen mounts `<Explainer {...EXPLAINERS[key]} />`; a unit test holds
 * that every default tab has an entry. The older per-screen constants are re-exported here, not rewritten.
 */
import type { ReactNode } from "react";
import { DEFAULT_TABS, MODULE_KEYS } from "@foundmill/shared/constants";
import { TEAM_RECRUITMENT_EXPLAINER } from "./team/RecruitmentScreen";
import { TEAM_AGENTS_EXPLAINER } from "./team/SquadScreen";
import { PULL_REQUESTS_EXPLAINER } from "./development/PullRequestsScreen";
import { FINANCE_EXPLAINER } from "./finance/OverviewScreen";
import { LEGAL_EXPLAINER } from "./legal/shared";
import { PUBLIC_PAGE_EXPLAINER } from "./product/PublicPageScreen";

/** A line is text, or text with a defined word in it (the older constants use `<Term>`). */
export type ExplainerCopy = { screenId: string; purpose: ReactNode; action: ReactNode; watchFor: ReactNode };

const entry = (screenId: string, purpose: string, action: string, watchFor: string): ExplainerCopy => ({ screenId, purpose, action, watchFor });

export const EXPLAINERS: Readonly<Record<string, ExplainerCopy>> = {
  "product/roadmap": entry("product/roadmap", "What your team plans to build, in order.", "Read the next three items. Say so if the order is wrong.", "A date here is a plan, labeled Estimate, until the work is done."),
  "product/specification": entry("product/specification", "What your product does, written so your team can build it.", "Read it once and approve it, or ask for changes in your own words.", "Your team builds what this says, so a wrong line here becomes wrong work."),
  "product/public-page": PUBLIC_PAGE_EXPLAINER,
  "distribution/first-ten": entry("distribution/first-ten", "Ten people to talk to first, one at a time.", "Add someone you know, copy a message to send yourself, and write down what they say.", "Nothing here is sent for you. An empty slot is just an empty slot."),
  "distribution/creative": entry("distribution/creative", "Every post, email and ad your team has drafted, before anyone outside sees it.", "Open a draft, then approve it, reject it or share it yourself.", "A draft is not published until you approve it or post it yourself."),
  "distribution/leads": entry("distribution/leads", "People who might buy, and where each one stands.", "Open a lead to see what your team knows about them.", "Nothing is sent to a lead until you approve it."),
  "distribution/campaigns": entry("distribution/campaigns", "Each push to find customers, such as an email series or a post.", "Check the message and the audience before you say go.", "A campaign that contacts people outside waits for your yes."),
  "finance/overview": FINANCE_EXPLAINER,
  "finance/runway": entry("finance/runway", "How many months your cash lasts at today's spending.", "Connect a bank to turn the estimate into a real figure.", "Until a bank is connected, every number here is an Estimate."),
  "legal/entity": LEGAL_EXPLAINER,
  "legal/compliance": entry("legal/compliance", "The rules that apply to your business, and what is done about each.", "Read what is open and ask your team what a rule means in plain words.", "This is not legal advice. Check anything with a deadline with a lawyer."),
  "development/pull-requests": PULL_REQUESTS_EXPLAINER,
  "development/environments": entry("development/environments", "The places your product runs: a preview to try changes, and the live one.", "Open the preview to try a change before it goes live.", "Nothing goes live until you say so."),
  "team/squad": TEAM_AGENTS_EXPLAINER,
  "team/recruitment": TEAM_RECRUITMENT_EXPLAINER,
  milestones: entry("milestones", "The moments that mark your progress, like a first page live or a first sale.", "Share one when you are proud of it. Each card is yours to post.", "Only real outcomes count here. Simulated results never do."),
  crm: entry("crm", "Everyone your business talks to: customers, leads and partners.", "Search for a person to see every note and message about them.", "Your team may add contacts it finds. Check them before you reach out."),
  inbox: entry("inbox", "The few things only you can decide, and notes from your team.", "Open the top item and choose an option. Your team keeps working on the rest.", "A choice that spends money or contacts someone outside waits for your yes."),
  home: entry("home", "The dashboards behind Today: your week in numbers and charts.", "Look here when you want more than Today shows.", "A number labeled Estimate or Forecast is not measured yet."),
  calls: entry("calls", "A call where you talk a decision through with your team.", "Pick the agents you want on the call, then start it.", "Nothing is done during a call. Agents suggest, and you decide afterward."),
  "settings/basics": entry("settings/basics", "The few settings most people need, each one press away.", "Open one to change it. Everything else is in the other sections.", "These apply to this project. Preferences are yours in every project."),
  "settings/business": entry("settings/business", "Your project's name, logo, colors, currency and time zone.", "Change what is wrong, then save.", "A new currency changes how every amount reads."),
  "settings/mode": entry("settings/mode", "How much your team may do on its own, and what it may spend without asking.", "Pick the mode that fits how closely you want to watch.", "In every mode your team never moves money or signs for you."),
  "settings/departments": entry("settings/departments", "The groups your team is organized in, and the tabs each one shows.", "Rename a group, or hide one you do not need.", "Renaming only changes the label. What the group does stays the same."),
  "settings/glossary": entry("settings/glossary", "The names your project uses for its own things, such as customers or orders.", "Rename a word and your team uses your word from then on.", "Change one word at a time, so every page still reads clearly."),
  "settings/members": entry("settings/members", "The people building this project with you, if you want company.", "Invite a cofounder or a collaborator with a link.", "Each person can open only what their access allows."),
  "settings/integrations": entry("settings/integrations", "The tools your team can use for you, connected with your own account.", "Connect one when your team needs it. Nothing is connected for you.", "Changes your team makes here run without asking and show in your activity. Spending money or contacting someone outside still asks you first."),
  "settings/keys": entry("settings/keys", "Your own Anthropic key, if you want your team to run on your account.", "Paste a key to use it. You can remove it at any time.", "Your key is stored sealed, and Anthropic bills you directly for its use."),
  "settings/billing": entry("settings/billing", "Your plan, your credits and what your team has used.", "Add credits when the balance runs low.", "A running task finishes even if credits run out. The next one waits."),
  "settings/preferences": entry("settings/preferences", "How things look and behave for you, in every project.", "Change the date format, the text size or Builder view.", "These are yours alone. Nobody else on the project sees them."),
  "settings/danger": entry("settings/danger", "Actions that are hard to undo, like deleting this project.", "Read what each one does before you press it.", "A deletion is scheduled first, so you can still cancel it."),
};

/** The copy for a department tab, or undefined. */
export const explainerForTab = (moduleKey: string, slug: string): ExplainerCopy | undefined => EXPLAINERS[`${moduleKey}/${slug}`];

/** Default tabs with no entry (the unit test expects none). */
export const missingExplainers = (): string[] => MODULE_KEYS.flatMap((k) => DEFAULT_TABS[k].filter((s) => !EXPLAINERS[`${k}/${s}`]).map((s) => `${k}/${s}`));

/** The department tabs whose screens do not mount their own Explainer: `DepartmentScreen` mounts these (the older ones carry theirs). */
export const HOST_MOUNTED = ["product/roadmap", "product/specification", "distribution/leads", "distribution/campaigns", "finance/runway", "legal/compliance", "development/environments"] as const;
