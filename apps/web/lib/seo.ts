/**
 * What the site tells crawlers (WP-03 T6; docs/holistic-plan/WP-03-the-door.md). One place, so robots.txt, the sitemap and
 * /llms.txt cannot disagree about whether Foundmill is open to search.
 *
 * Indexing follows open sign-up (founder, 2026-11-15, docs/log/2026-11/2026-11-15-claude-landing-seo.md): a page that
 * ends at a waitlist would spend the one first impression a search gives. It is read at build time, as the home page's
 * own metadata is, so the home page and robots.txt flip together. It is also tied to the production origin, never to
 * APP_ENV (production reports "staging", audits/e0-production-evidence.md), so a preview deployment is never indexed.
 */
import { APP_NAME, APP_ORIGIN } from "@foundmill/config";
import { landingSwitches } from "@/components/landing/flags";
import { canonicalOrigin } from "@/lib/auth/canonical-origin";

export function indexable(env: Record<string, string | undefined> = process.env): boolean {
  return onProductionOrigin(env) && landingSwitches(env).signupOpen;
}

const onProductionOrigin = (env: Record<string, string | undefined>): boolean => canonicalOrigin(env.NEXT_PUBLIC_APP_URL) === APP_ORIGIN;

/**
 * The public waitlist page (app/waitlist; WP-14 T15). The one exception to "indexing follows open sign-up" (founder,
 * 2026-11-17, answer A7): it is indexable on the production origin now, because it is the page that says when the next
 * batch opens. Nothing else is: robots.txt allows this address alone until `indexable()`.
 */
export const WAITLIST_PATH = "/waitlist";
export function waitlistIndexable(env: Record<string, string | undefined> = process.env): boolean {
  return onProductionOrigin(env);
}

/** Pages with their own address that are not a project's or a person's: the home page, the two legal pages and the waitlist page. */
export const STATIC_SITEMAP_PATHS = ["/", "/terms", "/privacy", WAITLIST_PATH] as const;

export interface ListedPath {
  path: string;
  lastModified: Date;
}

/**
 * Project pages that are public and listed (WP-08 D5: a page with under 400 characters of "about" is public and not
 * listed). WP-08 fills this from its listing rule (`publicPage.listed`, pull request #244); until that merges, the
 * sitemap names only the static pages.
 */
export async function listedPublicPaths(): Promise<ListedPath[]> {
  return [];
}

/**
 * The sitemap's entries: the static paths, then the listed pages, absolute and without repeats. No priority or changefreq.
 * `open: false` (sign-up not open: robots.txt allows the waitlist page alone) names that one page only, so the sitemap
 * never lists an address robots.txt closes.
 */
export function sitemapEntries(listed: readonly ListedPath[], opts: { open?: boolean } = {}): { url: string; lastModified?: Date }[] {
  if (opts.open === false) return [{ url: `${APP_ORIGIN}${WAITLIST_PATH}` }];
  const seen = new Set<string>();
  const out: { url: string; lastModified?: Date }[] = [];
  const add = (path: string, lastModified?: Date) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push(lastModified ? { url: `${APP_ORIGIN}${path}`, lastModified } : { url: `${APP_ORIGIN}${path}` });
  };
  for (const path of STATIC_SITEMAP_PATHS) add(path);
  for (const item of listed) add(item.path, item.lastModified);
  return out;
}

/**
 * AI training crawlers (founder decision D2, 2026-11-15): allowed on Foundmill's own pages, kept off /p/ and /u/, the
 * pages founders and people make. These are the training tokens only. Search and answer crawlers (OAI-SearchBot,
 * Claude-SearchBot, PerplexityBot) and assistants fetching a page for a person (ChatGPT-User, Claude-User) are not
 * listed: they follow the general group, so listed project pages can be found and cited.
 */
export const AI_TRAINING_CRAWLERS = ["GPTBot", "ClaudeBot", "anthropic-ai", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider", "Meta-ExternalAgent"] as const;

/** Paths no crawler needs: the API and the signed-in app. /login, /m/, /i/ and /a/ stay readable so their noindex is seen. */
export const PRIVATE_PATHS = ["/api/", "/b/"] as const;
export const MADE_BY_PEOPLE_PATHS = ["/p/", "/u/"] as const;

export function llmsTxt(opts: { signupOpen: boolean }): string {
  const lines = [
    `# ${APP_NAME}`,
    "",
    `> ${APP_NAME} is a web app where one person works with a team of AI agents to start a project of their own. The team shapes the idea, rates it honestly, drafts a public page for it and plans the next steps. The founder makes every decision that spends money or acts in their name.`,
    "",
    "Facts:",
    "- For: people starting a first project, on their own or with cofounders. 18 or older.",
    "- Cost: free to start with a monthly allowance of agent work and no card. Paid plans are not open yet.",
    ...(opts.signupOpen ? [] : ["- New people are let in a few at a time, in batches."]),
    `- Every project gets a free public page at ${APP_ORIGIN.replace("https://", "")}/p/<name>.`,
    "- Agents never move money, sign, accept terms or file anything in the founder's name.",
    "",
    "## Pages",
    `- [Home](${APP_ORIGIN}/): what ${APP_NAME} is, what it costs and example first weeks`,
    ...(opts.signupOpen ? [] : [`- [Waitlist](${APP_ORIGIN}${WAITLIST_PATH}): when the next batch opens and how many places it has`]),
    `- [Terms of Service](${APP_ORIGIN}/terms)`,
    `- [Privacy Policy](${APP_ORIGIN}/privacy)`,
    "",
    "## For agents",
    "- The projects shown on the home page and on /tour are examples, not customers.",
    "",
  ];
  return lines.join("\n");
}
