/**
 * Empty screens say what will fill them and when (founder's report, Phase 3 group K "A first week that explains
 * itself"): a screen or panel that is empty because the business is new gets one sentence about what appears there
 * and what makes it appear, never a bare "No data" or a dash. One table here, so the ~15 founder tabs and Today read
 * the same way and a sentence is changed in one place.
 *
 * Rules: only for a whole panel or screen with nothing in it (a real 0 in a tile stays 0, an optional cell stays "—");
 * the "when" is a fact the founder controls or the first-week timeline (packages/shared first-week.ts) states, never a
 * promise of a date; US English; no football words; the phrasing keeps to "nothing … yet" plus what fills it and when,
 * so Development's "What exists now" panel (Pull requests, Environments) reads the same.
 *
 * Loading skeletons are not empty states: callers show this only once the read has answered.
 */
import { noChannelSentence, type NoChannelFacts } from "./channel-availability";

export type EmptyWhyId =
  | "today_needs_you"
  | "leads"
  | "campaigns"
  | "contacts"
  | "milestones"
  | "roadmap"
  | "spec"
  | "spec_versions"
  | "cash_history"
  | "cash_flow"
  | "bank"
  | "entity"
  | "officers"
  | "compliance"
  | "hired_agents"
  | "channel_board";

/** What the caller knows; every field is optional, the words fall back to the sentence that holds either way. */
export interface EmptyWhyFacts {
  /** Today: the business is in its first days (the first-week timeline shows). */
  firstDays?: boolean;
  /** The business has started distribution (answered "Ready to start selling?"). */
  distributionStarted?: boolean;
  /** The Channel Board with no channel that can run on its own: what opens first (channel-availability.ts). */
  noChannel?: NoChannelFacts;
}

export interface EmptyWhy {
  /** A short heading where the empty state has one ("No leads yet"). */
  title?: string;
  /** One sentence: what will appear here and when. */
  text: string;
}

const READY = "“Ready to start selling?”";

export function emptyWhy(id: EmptyWhyId, facts: EmptyWhyFacts = {}): EmptyWhy {
  switch (id) {
    case "today_needs_you":
      return facts.firstDays
        ? { text: `Nothing needs you yet. Your first notes, the specification and the roadmap to sign off, arrive once the team finishes drafting them, usually on day 1.` }
        : { text: "Nothing needs you right now. The team keeps working." };
    case "leads":
      return facts.distributionStarted
        ? { title: "No leads yet", text: "Qualified leads arrive here with their lawful basis as soon as Lead generation finds someone who fits." }
        : { title: "No leads yet", text: `Leads appear here once the team starts selling, after you answer ${READY}. Each arrives with its lawful basis.` };
    case "campaigns":
      return facts.distributionStarted
        ? { title: "No campaigns yet", text: "Each channel on the board plans its first campaign here and asks for your approval before launch." }
        : { title: "No campaigns yet", text: `Campaigns appear here once the team starts selling, after you answer ${READY}. Each asks for your approval before it launches.` };
    case "contacts":
      return { text: `Nothing here yet. People and organizations arrive as imports run and as the team works, starting with the first leads once you answer ${READY} Add one by hand or connect an importer to fill it sooner.` };
    case "milestones":
      return { text: "Nothing here yet. Releases, decisions, incorporation, funding and launches appear as they happen; the first usually come with the first changes going live, from day 2." };
    case "roadmap":
      return { title: "Nothing on the roadmap yet", text: "The Product lead turns the specification into Now, Next and Later in the team's first round of work, usually on day 1, and asks for your sign-off. You can add an item yourself any time." };
    case "spec":
      return { title: "No spec yet", text: "The team drafts the specification in its first round of work, usually on day 1, and asks for your sign-off before building starts." };
    case "spec_versions":
      return { text: "Nothing published yet. A version appears when you sign off the specification, when a change proposal is accepted or when you publish the current spec." };
    case "cash_history":
      return { text: "Cash history appears after you connect a bank account in Settings › Integrations, and grows as transactions sync." };
    case "cash_flow":
      return { text: "Monthly inflows and outflows appear after you connect a bank account, once its transactions sync." };
    case "bank":
      return { title: "No bank or revenue data yet", text: "Connect a bank account (Tink or Plaid) or Stripe and the tiles fill with cash, burn, runway and revenue as soon as the first transactions sync." };
    case "entity":
      return { title: "No legal entity yet", text: "Import an existing company on the right, or start an incorporation on the Incorporate tab; the entity's facts appear here as soon as either is done." };
    case "officers":
      return { text: "Nothing here yet. Officers appear once a company is imported or formed; each becomes a contact with the officer role." };
    case "compliance":
      return { title: "No deadlines yet", text: "The calendar fills when you import a company, from its registry, or when an incorporation adds its first filings. Deadlines the legal lead records appear here too." };
    case "hired_agents":
      return { text: "Nothing hired yet. An agent you hire from the catalog appears here as soon as you confirm; use the … on a row to duplicate it, lend it to another department or let it go." };
    case "channel_board":
      return { title: "No channels to run yet", text: noChannelSentence(facts.noChannel) };
  }
}
