/**
 * The Chief of Staff's build recommendation (founder, Nov 25, 2026): once the plan is drafted, one note recommends
 * either "Build it ourselves" (the engineering agents) or "Build it with Lovable", and says precisely why for this idea,
 * or says the idea needs no software built. The choice is a written rubric over the founder's own words, never a
 * model's mood: each rule names the words that matched, so the note quotes the parts of the idea that drive it, and the
 * evals check the rubric directly (evals/src/build-choice).
 *
 * Costs are stated once and plainly on both sides. Lovable needs the founder's own Lovable account, and its credits are
 * Lovable's, billed by Lovable; our agents use Foundmill credits. Lovable's price is an Estimate, labeled as one.
 */
import { APP_NAME } from "@foundmill/config";
import type { Archetype } from "@foundmill/shared";
import type { FoundationsIdea } from "./foundations";

export type BuildChoice = "ours" | "lovable" | "none";
export type BuildRuleSide = "lovable" | "ours" | "no_software";

export interface BuildRule {
  id: string;
  side: BuildRuleSide;
  /** What the rule looks for in the founder's words. */
  pattern: RegExp;
  /** Why it points this way, after the quoted words. */
  because: string;
}

/**
 * The rubric. Lovable fits a web app with a standard interface (accounts, records to add and change, a dashboard) that
 * the founder wants to click through soon and change by eye. Our engineering agents fit the project's page at its free
 * Foundmill address, work that leans on the project's own data and tools, backend or non-web work, commerce on Shopify or
 * Stripe, code in the founder's own repository, and a founder who wants no other account or bill. An idea with no
 * software to build (a physical product, an in-person service) gets neither.
 */
export const BUILD_RULES: readonly BuildRule[] = Object.freeze([
  { id: "web_app", side: "lovable", pattern: /\b(web ?apps?|saas|software as a service|online tool)\b/i, because: "a web app with a standard interface is what Lovable builds fastest" },
  { id: "accounts", side: "lovable", pattern: /\b(log ?ins?|sign ?ups?|sign ?ins?|user accounts?|accounts? for|members? area)\b/i, because: "people signing in to their own account is built into Lovable" },
  { id: "dashboard", side: "lovable", pattern: /\b(dashboards?|admin panels?|portals?|back ?office)\b/i, because: "a dashboard is a standard screen Lovable lays out for you to click through" },
  { id: "records", side: "lovable", pattern: /\b(track(s|ing|er)?|log(s|ging)? (their|your|my)|to-?do|inventory|database|keep records?|lists? of)\b/i, because: "adding, changing and listing records is the everyday work Lovable's apps do" },
  { id: "marketplace", side: "lovable", pattern: /\b(marketplace|directory|matches? (people|buyers|sellers)|listings?)\b/i, because: "listings and profiles in one app are a common Lovable starting point" },
  { id: "prototype", side: "lovable", pattern: /\b(prototype|mvp|mock-?up|click through|try it out|see what it looks like|design it visually)\b/i, because: "you want to see and click through it soon, and Lovable lets you change it by eye" },
  { id: "app", side: "lovable", pattern: /\b(an? (simple )?app|the app|apps? (that|where|for|to))\b/i, because: "it is an app people use in the browser" },

  // What the project's own page already covers (founder, Nov 25, 2026): never Lovable. Booking and payments are the page's own.
  { id: "page", side: "ours", pattern: /\b(landing page|website|web ?site|one[- ]page|newsletter|blog|portfolio|waitlist|price list|pricing page|book(ing|ings)?|appointments?|take payments?|pay online|payment button)\b/i, because: `a page like this is your project's page at its free ${APP_NAME} address, with its price and a button to pay or book, which the team builds and hosts` },
  { id: "backend", side: "ours", pattern: /\b(apis?|backend|back-end|data pipelines?|pipelines?|etl|scrap(e|er|ers|ing)|crawlers?|scripts?|automat(e|es|ion|ions)|bots?|webhooks?|cli|command line)\b/i, because: "work behind the screen is where our engineering agents write and test the code themselves" },
  { id: "integrations", side: "ours", pattern: /\b(integrat(e|es|ion|ions)|connects? (to|with)|syncs?|syncing|zapier|slack|discord|google sheets)\b/i, because: "connecting other tools runs through the project's own connectors, which our agents already use" },
  { id: "commerce", side: "ours", pattern: /\b(shopify|stripe|online store|e-?commerce|checkout|payment links?)\b/i, because: "work around Shopify or Stripe uses the store and payment tools the team already connects" },
  { id: "own_repo", side: "ours", pattern: /\b(github|open[- ]source|my own (code|repo|repository)|own the code|code repository)\b/i, because: "you want the code in your own repository, where our agents build it" },
  { id: "one_place", side: "ours", pattern: /\b(no (extra|other|new|more) (accounts?|subscriptions?|tools?|bills?)|in one place|keep it simple)\b/i, because: "you want no other account or bill, and our agents work inside your project" },
  { id: "native", side: "ours", pattern: /\b(chrome extension|browser extension|plugins?|ios|android|native app|mobile app|desktop app)\b/i, because: "Lovable builds web apps only, so this needs our own engineering agents" },
  { id: "own_data", side: "ours", pattern: /\b(my (customers|leads|followers|subscribers)|customer list|reports? from|analytics|ai (agent|assistant)|uses? ai)\b/i, because: "it leans on the project's own data and tools, which only our agents can reach" },

  { id: "physical", side: "no_software", pattern: /\b(etsy|handmade|hand-made|physical products?|candles?|jewelry|soaps?|bakery|baked goods|cookies|cakes|clothing|t-?shirts?|prints|ceramics|pottery|crafts?|knit(ted|ting)?|furniture|plants|food truck|catering|coffee cart)\b/i, because: "it is a product people hold, so there is no app to build" },
  { id: "in_person", side: "no_software", pattern: /\b(cleaning|tutor(s|ing)?|coach(ing)?|dog walk(ing|er)|lawn|mowing|repairs?|handyman|photograph(y|er)|personal train(ing|er)|babysitting|moving help)\b/i, because: "it is a service done in person, and your project's page and its booking cover what customers need online" },
]);

export interface BuildChoiceInput {
  /** The founder's own words for the idea, else the idea's pitch; the title and the studio brief join it. */
  ideaText: string;
  archetype: Archetype | null;
  founderFirstName: string | null;
}

export interface BuildChoiceHit {
  rule: string;
  side: BuildRuleSide;
  quote: string;
  because: string;
}

export interface BuildChoiceResult {
  choice: BuildChoice;
  hits: BuildChoiceHit[];
  score: { lovable: number; ours: number; noSoftware: number };
}

/** The matched words with up to three of the founder's words on each side. */
function quoteAround(text: string, index: number, length: number): string {
  const before = text.slice(0, index).split(" ");
  const after = text.slice(index + length).split(" ");
  const head = before.slice(-4).join(" ");
  const tail = after.slice(0, 4).join(" ");
  // Markdown characters are escaped: the quote is shown in a note, and a link or emphasis in the idea stays plain text.
  const quote = `${head}${text.slice(index, index + length)}${tail}`.replace(/[.,;:!?]+$/, "").trim().replace(/([\\`*_[\]()<>#!|])/g, "\\$1");
  return `${before.length > 4 ? "…" : ""}${quote}${after.length > 4 ? "…" : ""}`;
}

/**
 * The rubric applied: every rule that matches the founder's words, and the choice. No software rules and no software
 * signal means "none". Otherwise Lovable needs more signals than our agents; a tie, or nothing to go on, is ours, since it
 * needs no other account or bill.
 */
export function chooseBuild(input: BuildChoiceInput): BuildChoiceResult {
  const text = input.ideaText.replace(/\s+/g, " ").trim();
  const hits: BuildChoiceHit[] = [];
  for (const r of BUILD_RULES) {
    const m = r.pattern.exec(text);
    if (m) hits.push({ rule: r.id, side: r.side, quote: quoteAround(text, m.index, m[0].length), because: r.because });
  }
  // The archetype is a tie-breaker only: a physical product or a service with no software words needs no build.
  const score = { lovable: hits.filter((h) => h.side === "lovable").length, ours: hits.filter((h) => h.side === "ours").length, noSoftware: hits.filter((h) => h.side === "no_software").length };
  const software = score.lovable + score.ours;
  const physicalArchetype = input.archetype === "dtc_physical" || input.archetype === "services" || input.archetype === "hardware";
  if (software === 0 && (score.noSoftware > 0 || physicalArchetype)) return { choice: "none", hits, score };
  // What the page covers is never Lovable's (founder, Nov 25, 2026): only an app with accounts, records or a dashboard of its
  // own outweighs it.
  const pageCovered = hits.some((h) => h.rule === "page") && !hits.some((h) => APP_OF_ITS_OWN.has(h.rule));
  return { choice: !pageCovered && score.lovable > score.ours ? "lovable" : "ours", hits, score };
}

/** Lovable signals that mean an app of its own, beyond what the project's page covers. */
const APP_OF_ITS_OWN: ReadonlySet<string> = new Set(["web_app", "accounts", "dashboard", "records"]);

/** Lovable's price as stated in the note: an Estimate, from Lovable's own pricing page as read on Nov 25, 2026. */
export const LOVABLE_PRICE_ESTIMATE = "Estimate: Lovable's paid plans start at about $25 a month";

export const BUILD_CHOICE_NOTE = {
  keyPrefix: "build_choice:",
  options: { ours: "build_ourselves", lovable: "build_with_lovable" },
  oursLabel: "Build it ourselves",
  lovableLabel: "Build it with Lovable",
  oursCost: `Build it ourselves: the engineering agents use your ${APP_NAME} credits, with no other account or bill.`,
  lovableCost: `Build it with Lovable: it needs your own Lovable account, and its credits are Lovable's, billed by Lovable. Lovable has a free plan with daily limits (${LOVABLE_PRICE_ESTIMATE}).`,
  oursConsequence: "The engineering agents build it from your plan once you approve the plan.",
  lovableConsequence: "If Lovable is connected, I create the project in your Lovable workspace from your plan and send you its link. If not, I give you a link that opens Lovable with your plan as the first message, and you press send there.",
  noChoice: "If you choose neither, the engineering agents build it from your plan once you approve it. You can pick the other option at any time.",
} as const;

/** The build choice a note decides (its `decision.key` is `build_choice:<businessId>`), or null for any other note. */
export function isBuildChoiceDecision(decision: unknown): boolean {
  const key = decision && typeof decision === "object" ? (decision as { key?: unknown }).key : null;
  return typeof key === "string" && key.startsWith(BUILD_CHOICE_NOTE.keyPrefix);
}

export interface BuildChoiceNote {
  subject: string;
  bodyMd: string;
  /** Null for an idea with no software to build: the note is a report with nothing to decide (never an update, which would replace the welcome note). */
  decision: { key: string; options: { id: string; label: string; recommended: boolean; consequence: string; because?: string; cost_minor: number; cost_in_note: true; reversible: boolean }[]; free_text: false; expires_at: null } | null;
}

const reasonLines = (hits: BuildChoiceHit[], side: BuildRuleSide): string[] => hits.filter((h) => h.side === side).slice(0, 5).map((h) => `- “${h.quote}”: ${h.because}.`);

/** The Chief of Staff's note: the recommendation, the founder's words that drive it, both costs, and the two buttons. */
export function buildChoiceNote(businessId: string, input: BuildChoiceInput, result: BuildChoiceResult = chooseBuild(input)): BuildChoiceNote {
  const hello = input.founderFirstName ? `${input.founderFirstName}, ` : "";
  if (result.choice === "none") {
    const why = reasonLines(result.hits, "no_software");
    // What is built comes first (founder, Nov 25, 2026): "needs no app" must never read as "nothing gets built".
    return {
      subject: "No separate app needed: your page covers it",
      bodyMd: [
        `${hello ? `${hello}the` : "The"} team builds your project's page at its free ${APP_NAME} address, with your price and a button to pay or book; it goes live when you publish it. Beyond that page there is no separate app to build, so I recommend neither the engineering agents nor Lovable for one.`,
        ...(why.length ? ["", "Why, from your idea:", ...why] : []),
        "",
        "If you later want an app, tell me and I'll recommend how to build it.",
      ].join("\n"),
      decision: null,
    };
  }
  const lovable = result.choice === "lovable";
  const why = reasonLines(result.hits, lovable ? "lovable" : "ours");
  const other = reasonLines(result.hits, lovable ? "ours" : "lovable").slice(0, 1);
  const first = lovable ? `${hello}I recommend building it with Lovable.` : `${hello}I recommend that we build it ourselves, with the engineering agents.`;
  const fallbackWhy = lovable ? [] : ["- Nothing in your idea needs a separate app builder, and the engineering agents need no other account or bill."];
  return {
    subject: lovable ? "Build your app with Lovable?" : "Build your app with the engineering agents?",
    bodyMd: [
      first,
      "",
      "Why, from your idea:",
      ...(why.length ? why : fallbackWhy),
      ...(other.length ? ["", `What points the other way: ${other[0]!.slice(2)}`] : []),
      "",
      "What each costs:",
      `- ${BUILD_CHOICE_NOTE.oursCost}`,
      `- ${BUILD_CHOICE_NOTE.lovableCost}`,
      "",
      BUILD_CHOICE_NOTE.noChoice,
    ].join("\n"),
    decision: {
      key: `${BUILD_CHOICE_NOTE.keyPrefix}${businessId}`,
      options: [
        { id: BUILD_CHOICE_NOTE.options.ours, label: BUILD_CHOICE_NOTE.oursLabel, recommended: !lovable, consequence: BUILD_CHOICE_NOTE.oursConsequence, ...(!lovable && why.length ? { because: result.hits.find((h) => h.side === "ours")!.because } : {}), cost_minor: 0, cost_in_note: true, reversible: true },
        { id: BUILD_CHOICE_NOTE.options.lovable, label: BUILD_CHOICE_NOTE.lovableLabel, recommended: lovable, consequence: BUILD_CHOICE_NOTE.lovableConsequence, ...(lovable ? { because: result.hits.find((h) => h.side === "lovable")!.because } : {}), cost_minor: 0, cost_in_note: true, reversible: false },
      ],
      free_text: false,
      expires_at: null,
    },
  };
}

/** Lovable's Build with URL takes a prompt of at most 50,000 characters; the plan is cut well inside it. */
export const LOVABLE_PROMPT_MAX = 20_000;

/** The first message Lovable gets: what to build, for whom, and the specification, from the plan the founder approved or is reading. */
export function lovablePrompt(input: { businessName: string; ideaText: string; positioning: string | null; specification: { section: string; text: string }[] }): string {
  const spec = input.specification.filter((s) => s.text.trim()).map((s) => `### ${s.section}\n${s.text.trim()}`).join("\n\n");
  const parts = [
    `Build the first version of ${input.businessName} as a web app.`,
    `## The idea\n${input.ideaText.trim()}`,
    ...(input.positioning ? [`## Who it is for and why\n${input.positioning.trim()}`] : []),
    ...(spec ? [`## Specification\n${spec}`] : []),
    "Start with the smallest version that works end to end, with a clean, standard interface. Use US English.",
  ];
  return parts.join("\n\n").slice(0, LOVABLE_PROMPT_MAX);
}

/** Lovable's Build with URL: opens Lovable in the founder's own browser and account with the prompt filled in; the founder presses send. */
export const lovableBuildUrl = (prompt: string): string => `https://lovable.dev/#prompt=${encodeURIComponent(prompt.slice(0, LOVABLE_PROMPT_MAX))}`;

/**
 * The Lovable project from create_project's answer: its id, checked, and the link built from it on Lovable's own host.
 * The vendor's own `url` is never used: an answer is untrusted, and a link it chose could point anywhere.
 */
export function lovableProjectLink(structured: unknown): { id: string | null; url: string | null } {
  const s = (structured && typeof structured === "object" ? structured : {}) as { id?: unknown; project_id?: unknown };
  const id = [s.id, s.project_id].find((v): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v)) ?? null;
  return { id, url: id ? `https://lovable.dev/projects/${id}` : null };
}

/** The rubric as the Chief of Staff's template reads it (one line per rule), so a conversation about the choice uses the same criteria. */
export const BUILD_CHOICE_RUBRIC_TEXT = BUILD_RULES.map((r) => `${r.side === "lovable" ? "Lovable" : r.side === "ours" ? "Build it ourselves" : "No software"} (${r.id}): ${r.because}.`).join(" ");

/** The words the rubric reads: the founder's own description (else the pitch), the title and the studio brief. */
export const buildChoiceIdeaText = (idea: Pick<FoundationsIdea, "title" | "pitch" | "founderWords" | "brief">): string => [idea.title, idea.founderWords ?? idea.pitch, idea.brief].filter((v): v is string => !!v && !!v.trim()).join(". ");
