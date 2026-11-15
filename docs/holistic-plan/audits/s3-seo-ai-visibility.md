# Foundmill: search and AI-visibility review (S3)

Reviewed Nov 15, 2026. Live site https://foundmill.com (deployment `dpl_2f1kZVYG1jTV2LAuz75kRF1rTRkf`), repo `main` at `04a0a509`, Next.js 16.3.8 App Router in `apps/web`. Read-only: nothing in the repo was changed, no form was submitted, no build, test or dev server was run. No project page exists in production, so the `/p`, `/u` and `/m` templates were audited from code and from their live not-found answers.

## 0. Skills used

**Loaded with the Skill tool (18, all loaded).** Findings name their source in square brackets.

| Skill | Used for |
| --- | --- |
| `claude-seo:seo` (orchestrator) | Scoring weights, priority buckets, quality gates (no HowTo, FAQ rich results retired May 7, 2026, INP not FID) |
| `claude-seo:seo-technical` | Crawlability, indexability, redirects, security headers, JS rendering, IndexNow |
| `claude-seo:seo-page` | Title, description, canonical, robots, Open Graph, headings per page |
| `claude-seo:seo-content` | Who / How / Why test, E-E-A-T, thin content |
| `claude-seo:seo-schema` | Detection, type status, JSON-LD design |
| `claude-seo:seo-sitemap` | Sitemap checks and the design for thousands of pages |
| `claude-seo:seo-geo` | AI crawler taxonomy (search vs training vs user-triggered), llms.txt evidence, citability |
| `claude-seo:seo-agentic` | Agent-readiness priorities (server-rendered, robots groups, real 404s, Markdown, discovery files) |
| `claude-seo:seo-sxo` | Page-type check against the results pages for two head queries |
| `claude-seo:seo-programmatic` | Quality gates, uniqueness, index-bloat rules for the directory |
| `claude-seo:seo-images` | Share images, favicon, formats |
| `claude-seo:seo-plan` | The 30/60/90 structure |
| `marketing-skills:ai-seo` | Extractability check, three pillars, machine-readable files, what not to do |
| `marketing-skills:seo-audit` | Audit order (crawl, technical, on-page, content, authority), report format |
| `marketing-skills:site-architecture` | Hierarchy, URL map, navigation, internal-link rules |
| `marketing-skills:schema` | Feature-support check before recommending a type |
| `marketing-skills:programmatic-seo` | Directory and Profiles playbooks, hub and spoke, indexation strategy |
| `andrej-karpathy-skills:karpathy-guidelines` | Every fix is the smallest change that solves it, with a check that proves it |

**Scripts: none ran.** `claude-seo doctor` answered "Claude SEO needs Python 3.11 to 3.14. Found: 3.9 (python3)". This Mac has only the system Python 3.9, and installing was out of scope, so every `claude-seo` script check was done by hand:

- `sitemap_discovery.py`, `transport_check.py`, `page_checks.py`, `parse_html.py`, `agentic_check.py`: replaced with `curl` (status, headers, redirects, raw HTML), Python 3.9 standard library (head tags, headings, links, word counts, byte weights) and `openssl s_client` (certificate).
- AI-agent user-agent matrix [seo-agentic step 4]: one GET of `/` per token (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Googlebot, bingbot, three link-preview bots). The founder owns the site. This shows behavior toward unverified traffic only.
- SXO [seo-sxo]: two generic WebSearch queries with no brand name in them.

**Not measured (reported as such, never scored as passed):** Lighthouse and its Agentic Browsing fraction, Core Web Vitals (a site with no traffic has no field data anyway), rendered-DOM comparison (no Chromium), Rich Results Test and Schema.org validator runs, backlinks, and the brand results page and `site:` checks (these would send the project's name to a search engine; the exact queries are in section 7 for the founder to run). No paid data API was used. The `claude-seo` community footer with outside links is left out of this report.

**How to read scores:** they are these skills' heuristics, not Google's signals [seo-content, "Honest scoping"].

---

## 1. Scorecard for the live site

Overall: **about 42 of 100** (weights from `claude-seo:seo`: technical 22, content 23, on-page 20, structured data 10, performance 10, AI readiness 10, images 5). One sentence on what limits it most: **the home page tells search engines not to index it and not to follow its links, and nothing on the site lists or links the public pages.**

| Area | Score | Evidence |
| --- | --- | --- |
| Technical | 45 | `/robots.txt` → `404 text/html` (26,104 B, the app's own not-found page). `/sitemap.xml` → `404`. Any unknown signed-out path → `307` to `/login?next=…` (seen on `/llms.txt`, `/.well-known/security.txt`, `/pricing`, `/about`, `/blog`, `/Terms`). Good: `http://foundmill.com/` → `308` → `https://foundmill.com/` (one hop); `https://www.foundmill.com/` → `308` → apex; `/terms/` → `308` → `/terms`; HSTS `max-age=63072000; includeSubDomains`; CSP with `frame-ancestors 'none'`; `nosniff`; referrer and permissions policies; certificate valid Oct 6, 2026 to Jan 4, 2027 (Let's Encrypt); no `X-Robots-Tag` on pages; `x-nextjs-prerender: 1`, `x-vercel-cache: HIT`, first byte in about 125 ms. |
| On-page | 40 | `/`: `<title>Foundmill</title>` (9 characters), description "Build a real business with a team of AI agents." (47 characters, the same words as the `h1`), **`<meta name="robots" content="noindex, nofollow"/>`**, no canonical, no `og:url`. One `h1`, eight `h2`, sixteen `h3`, in order. `/terms` and `/privacy`: good titles, 130 to 150 character descriptions, `index, follow`, self canonical, one `h1`, numbered `h2` with anchors. |
| Content | 45 | `/` serves 2,302 visible words in the HTML, but about two thirds are the example business's interface (ticker lines, agent names, figures). No sentence that begins "Foundmill is…", no pricing page, no about page, no named person or company outside the legal pages, no dates. Trust: Terms and Privacy are plain, dated "Last updated Nov 13, 2026", with contact addresses. |
| Structured data | 0 | No `application/ld+json`, microdata or RDFa in `/`, `/login`, `/terms`, `/privacy` (raw HTML; the pages are server-rendered, so this is the real state), and none in `apps/web` or `packages/dugout` (`grep -rIl "ld+json"` finds only agent templates and evals). |
| AI visibility and agent readiness | 40 | Pass: hero and all copy are in the server response (the `h1` is at byte 17,602 of 459,856; 514 words before the first `h2`); every crawler token got `200` with the full page; 69 buttons all have names; the idea form has a label; `main`, `footer` and a labeled `nav` exist. Fail or absent: no robots.txt, so no deliberate group per AI purpose; `/llms.txt` → `307` to the sign-in page; `Accept: text/markdown` → `text/html`, no `Vary: Accept`; unknown URLs do not return 404; no JSON-LD; no WebMCP (none expected). Lighthouse Agentic Browsing: not measured. |
| Performance signals (no lab) | 60 | HTML 459,856 B raw, 45,578 B Brotli. Inline SVG is 174,577 B (38 %) in 188 elements; `class` attributes are 140,757 B; about 4,000 elements. One render-blocking stylesheet, 267,452 B raw, 43,760 B Brotli. 38 script files (37 `async`), 1.77 MB raw, about 604 KB Brotli. Fonts self-hosted woff2 (Inter, Barlow Semi Condensed), `font-display: swap`, none preloaded. No raster images in the page. Static assets `max-age=31536000, immutable`. |
| Images | 80 | Share image `/opengraph-image.png` 1200 × 630 PNG, 31 KB, on `/` and `/login`. 14 inline data-URI logos, all with `alt`. `/favicon.ico` → 404 (the SVG icon and the 180 px apple icon exist). |

**Indexability per route, today**

| Route | Status | Robots | Canonical | Note |
| --- | --- | --- | --- | --- |
| `/` | 200 | `noindex, nofollow` | none | From the root layout default (`apps/web/app/layout.tsx` line 18) |
| `/?example=glitchwick`, `/examples/glitchwick`, `/examples/northwind` | 200 | `noindex, nofollow` | none | Copies of the landing page on another example; `/examples/tutorlane` → 404 |
| `/login`, `/login?next=…` | 200 | `noindex, nofollow` | none | Correct |
| `/terms`, `/privacy` | 200 | `index, follow` | self | Correct; `/terms?utm_source=x` keeps the clean canonical |
| `/start`, `/home`, `/p`, `/u`, `/m` and any unknown path | 307 → `/login` | n/a | n/a | Should be 404 when the path is not an app route |
| `/p/<unknown>`, `/u/<unknown>`, `/m/<unknown>` | 404 | `noindex` | none | Correct status; empty `<body>` without JavaScript (finding 18) |
| `/p/<slug>`, `/p/<slug>/story`, `/u/<handle>` (from code) | 200 | `index, follow` | self | The only pages built to be indexed |
| `/m/<id>` (from code) | 200 | `noindex, follow` | self | Deliberate (DESIGN §9f) |
| `/p/<slug>/<key>.txt` | 200 or 404 | `X-Robots-Tag: noindex` | n/a | IndexNow key file only |

**Search results check [seo-sxo].** For "build a business with a team of AI agents platform for solo founders" the first results are product listings (Product Hunt, Indie Hackers, GoodFirms, stork.ai), vendor use-case pages (adaptive.ai), list articles ("best AI agents for solopreneurs") and press (Fortune, Small Business Trends). Named competitors in those results: Soloop, Cofounder (moge.ai), Vora IQ, Founderside Agents, MindPal, Adaptive, ZenBusiness's AI co-founder. For "how to start a business with no money and no experience using AI" the results are long guides (Shopify, QuickBooks, Entrepreneur, serif.ai's templated guides) and courses. Reading: a product home page is the right page type for the first query, and listings on the launch directories are how these products appear there; the second query is guide territory that a home page will not win. Foundmill's home page is aligned in type but is not eligible at all while it says noindex.

---

## 2. Findings

Severity: **P0** blocks indexing or sharing; **P1** fix before the first cohort of public pages; **P2** fix within the first 60 days; **P3** small. Every fix is the smallest change that solves it [karpathy-guidelines], with a check.

### P0

**1. The home page is `noindex, nofollow`.** [seo-technical, seo-page, seo-audit]
- Evidence: `curl -s https://foundmill.com/ | grep -o '<meta name="robots"[^>]*>'` → `<meta name="robots" content="noindex, nofollow"/>`. Source: `apps/web/app/layout.tsx` line 18, `robots: { index: false, follow: false }`; `apps/web/app/page.tsx` exports no metadata, so it inherits.
- Why it matters twice: Foundmill cannot appear for its own name, and every "Built on Foundmill" link from a founder's page (`/?via=p.<slug>`) lands on a page search engines are told to drop and not to follow. Today `/terms`, `/privacy`, `/p/*` and `/u/*` are indexable while `/` is not, which is the worst mix.
- Context: `docs/DEPLOY.md` runs this deployment with `NEXT_PUBLIC_APP_ENV=staging` and sign-up closed, so the hold may be deliberate. If so, keep it, but make it one decision: the day sign-up opens, ship the change below.
- Fix: keep the root default (it protects every app screen) and opt the landing page in, in `apps/web/app/page.tsx`:

```ts
import type { Metadata } from "next";
import { APP_NAME, APP_TAGLINE } from "@foundmill/config";

const TITLE = `${APP_NAME}: ${APP_TAGLINE.replace(/\.$/, "")}`; // 57 characters
const DESCRIPTION = "One person with a team of AI agents can build and run a real business. Foundmill shapes your idea, builds it and runs it in the open. You make the calls.";

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/", siteName: APP_NAME, type: "website" },
  robots: { index: true, follow: true },
};
```

- Assumption to check: the root `opengraph-image.png` is in the same route segment as `app/page.tsx`, so `og:image` should stay. The legal pages show that a child segment's `openGraph` drops the image (finding 11), hence the third check.
- Verify:
  - `curl -s https://foundmill.com/ | grep -o '<meta name="robots"[^>]*>'` → `content="index, follow"`
  - `curl -s https://foundmill.com/ | grep -o '<link rel="canonical"[^>]*>'` → `href="https://foundmill.com"` (with or without the trailing slash)
  - `curl -s https://foundmill.com/ | grep -c 'property="og:image"'` → `1` or more
  - `curl -s "https://foundmill.com/?via=p.test" | grep -o '<link rel="canonical"[^>]*>'` → the same clean address
  - `curl -s https://foundmill.com/login | grep -o '<meta name="robots"[^>]*>'` and `/examples/glitchwick` → still `noindex, nofollow`
  - A Playwright assertion in `apps/web/e2e/landing.spec.ts` on the robots meta and canonical.

### P1

**2. No robots.txt and no sitemap.** [seo-technical, seo-sitemap, seo-agentic P0 "robots.txt reachable, with deliberate groups"]
- Evidence: `curl -sI https://foundmill.com/robots.txt` → `HTTP/2 404`, `content-type: text/html`, `x-matched-path: /404`. `/sitemap.xml` the same. The proxy already leaves both paths alone (`apps/web/proxy.ts` matcher; `PUBLIC_PREFIXES` in `apps/web/lib/auth/redirects.ts`), but neither route exists. A 404 robots.txt means "no restrictions", so nothing is blocked; what is missing is the sitemap pointer and a stated policy.
- Fix, file `apps/web/app/robots.ts`:

```ts
import type { MetadataRoute } from "next";
import { APP_ORIGIN } from "@foundmill/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/b/"] }],
    sitemap: `${APP_ORIGIN}/sitemap.xml`,
  };
}
```

  Leave `/login`, `/m/`, `/i/`, `/a/` crawlable: their `noindex` only works if a crawler may fetch them. One wildcard group is the right default [ai-seo: "an allowlist of named crawlers silently excludes agent search APIs"]. The AI training policy is the founder's call, see section 5.
- Fix, file `apps/web/app/sitemap.ts`: section 3.2 has the design; the first version lists `/`, `/terms`, `/privacy` and every listed public page.
- Verify: `curl -s https://foundmill.com/robots.txt` → `text/plain`, contains `Sitemap: https://foundmill.com/sitemap.xml`; `curl -s https://foundmill.com/sitemap.xml | head -3` → `<?xml` and `<urlset`; every `<loc>` returns 200 and `index`.

**3. Unknown addresses answer with a redirect to sign-in, not a 404.** [seo-agentic P1 "unknown URLs return a real 404"; seo-technical "soft 404"]
- Evidence: `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://foundmill.com/llms.txt` → `307 https://foundmill.com/login?next=%2Fllms.txt`. The same for `/.well-known/security.txt`, `/.well-known/ai-catalog.json`, `/manifest.json`, `/pricing`, `/about`, `/Terms`, `/index.html`.
- Cause: `decideRedirect` in `apps/web/lib/auth/redirects.ts` sends every signed-out path that is not in `PUBLIC_PREFIXES` to `/login`.
- Fix: redirect only the paths that are app routes; let the rest reach Next's 404. In `decideRedirect`, inside `if (!authenticated)`, before the final `return`:

```ts
// Only app routes ask for sign-in. Any other address that is not public does not exist: let it be a 404.
if (!isFounderPath(pathname) && pathname !== SIGNED_IN_INDEX && !pathname.startsWith("/integrations/")) return { kind: "next" };
```

- Verify: `/llms-nope.txt` and `/.well-known/nope` → `404`; `/b/x`, `/home`, `/start`, `/network` → still `307`. Unit tests beside the existing redirect tests: `decideRedirect({ pathname: "/pricing-nope", authenticated: false })` → `{ kind: "next" }`.

**4. The public pages are orphans.** [site-architecture "no orphan pages"; seo-audit; programmatic-seo]
- Evidence (code): nothing indexable links to any `/p/<slug>` or `/u/<handle>`. The home page has 12 links: `/`, `/login`, `/terms`, `/privacy` and anchors. `ProjectPage.tsx` has one link, the "Built on Foundmill" mark, shown only on the free plan to signed-out visitors; a paid project's page has no link at all and never links to its own story. "Built by Maya and Sam" is plain text (`founderNames` are names only). The only internal link to a project page is from a founder's person page, and only when the page names its founders.
- Fix: the directory in section 4, plus two template links that need no directory: (a) "How {name} was built" from the project page to its story on every plan; (b) each founder's name linked to `/u/<handle>` when that profile is public (the API's `PublicPageView` must return `founders: { name, handle | null }[]` instead of `founderNames`).
- Verify (once a seeded page exists in a test): the Playwright spec `apps/web/e2e/public-page.spec.ts` finds `a[href="/p/<slug>/story"]` and `a[href^="/u/"]` on a page with a shown milestone and named founders.

**5. No structured data anywhere.** [seo-schema, marketing-skills:schema, seo-geo]
- Evidence: scorecard row. Fix: one small server component and the graphs in section 3.1. Verify: `curl -s <url> | grep -c 'application/ld+json'` → `1`; paste the page into validator.schema.org and the Rich Results Test (not run here).

**6. Every published page is indexable, whatever it says.** [seo-programmatic quality gates; seo-content thin content; seo-programmatic "site reputation abuse"]
- Evidence: `generateMetadata` in `app/p/[slug]/page.tsx`, `story/page.tsx` and `u/[handle]/page.tsx` returns `robots: { index: true, follow: true }` for any published page. A page can be a 140-character pitch and one sentence; the first draft is written by a model from one line of the founder's (`packages/agents/src/prompts/project-page.ts`); the whole page is capped near 300 words (`PAGE_ABOUT_MAX` 1,500 characters). A person page with only a name is indexable too. Thousands of such pages on one host is the pattern the scaled-content and thin-content gates exist for, and they would pull down the host that every founder shares.
- Fix: one predicate, used by the robots meta, the sitemap and the directory, so the three can never disagree (section 3.3). Settle it before pages exist in volume.
- Verify: unit tests on the predicate; a published page under the gate returns `noindex, follow` and is absent from `/sitemap.xml`.

### P2

**7. Changing a project's address breaks every link to it, and frees the old address at once.** [seo-technical redirects; site-architecture "changing URLs without redirects"]
- Evidence: `apps/api/src/services/pages.ts` lines 192 to 196 emit `page.unpublished` for the previous slug; `repos.pages.setSlug` overwrites the slug; no table holds the old one. Person handles are held for 90 days (`person_handle_releases`, migration 0080) but do not redirect either.
- Fix: a `project_page_slug_releases` table shaped like `person_handle_releases` (same 90-day hold), and have `publicPage.bySlug` and `publicPerson.byHandle` answer `{ movedTo }` for a held address so the page calls `permanentRedirect()`. Verify: change an address in a test, then `curl -sI /p/<old>` → `308` with `location: /p/<new>`; another project cannot claim `<old>` for 90 days.

**8. IndexNow for a hosted page probably cannot name the page itself, and Google does not take IndexNow.** [seo-technical §9]
- Evidence: the key file is served at `/p/<slug>/<key>.txt` and the tool accepts exactly `/p/<slug>` (`packages/connectors/src/connectors/indexnow/tools.ts` line 142). By the protocol's own rule a key file covers addresses that start with its folder, here `/p/<slug>/`; `/p/<slug>` does not start with that. DECISIONS (2026-11-12) lists this as an open point. Each founder must also create and connect a key, which a first-week founder will not do.
- Fix (a founder decision, because it touches the "founder's own key" rule): treat IndexNow for Foundmill's own host as Foundmill's site plumbing, not a founder's connector. One platform key file at the site root, and the API's outbox consumer for `page.published`, `page.unpublished` and a shown milestone submits the changed address. Founders with their own domain keep the connector. Verify: one real submission of a live page; expect `200` or `202`, not `422`.

**9. The home page gives an assistant no definition, no price and no maker, and its example figures read like claims.** [ai-seo extractability; seo-geo citability; seo-content Who/How/Why]
- Evidence: no "Foundmill is…" sentence anywhere in the served text; "pricing" appears 0 times; the example's lines ("Juno raised grading accuracy from 74% to 93% on the test set", "64 of 64 matched", "$480.00 (Estimate)") make up most of the words; nothing in the HTML tells a machine the block is an example except the visible "Example" chips.
- Fix: (a) one plain block near the top of `components/landing`, visible to people: "Foundmill is a web app where one person works with a team of AI agents to build and run a real business: it shapes the idea, builds the product, finds customers and keeps the books, and asks you before anything that moves money or signs in your name." followed by three facts (who it is for; free to start with included credits and no card; 18 or older). (b) Put `data-nosnippet` on the example deck, the ticker and the example windows, so Google does not quote example figures as snippets. (c) A `/pricing` page as soon as there is a price to state, even "Free to start. Paid plans are not open yet." Verify: `curl -s https://foundmill.com/ | grep -c "Foundmill is a web app"` → `1`; `grep -c data-nosnippet` → 3 or more.

**10. Terms and Privacy have no share image.** [seo-page]
- Evidence: `/terms` and `/privacy` emit `og:title`, `og:description`, `og:url`, `og:type` and no `og:image` or `og:site_name`; `twitter:card` is `summary`. Cause: `legalMetadata` in `apps/web/content/legal/routes.ts` sets its own `openGraph`, which replaces the root's.
- Fix: add `siteName: APP_NAME, images: ["/opengraph-image.png"]` to that `openGraph`. Verify: `curl -s https://foundmill.com/terms | grep -c 'property="og:image"'` → `1`.

**11. Crawl capacity of the public pages is bounded by the API's per-caller limit.** [seo-technical crawl rate; programmatic-seo indexation]
- Evidence: every `/p`, `/u`, `/m` render is `force-dynamic` with `cache: "no-store"` and makes two or three API reads; `PUBLIC_PAGE_LIMITS.perCaller` is 300 a minute per address the API sees, and the comment says every reader of the web shares a few such addresses. A refused read rejects, which renders an error page. With thousands of pages, one crawler burst plus link previews can cross that, and 5xx answers make crawlers back off.
- Fix: do nothing now except measure (log refusals on public reads by route). If refusals appear, raise the limit for the web's own server-to-server calls before adding any cache; "taken down is gone at once" is worth more than cached pages. Verify: zero refused public reads in a week of logs after the first sitemap submission.

**12. No way to report a public page.** [seo-programmatic site reputation; seo-content trust]
- Evidence: `ProjectPage.tsx`, `PersonPage.tsx` and `ProjectStory.tsx` carry no report link; the publish checks are personal data and markup only (`PAGE_HOLD_REASONS`). User pages on a shared host are where spam lands first, and a spam manual action is host-wide.
- Fix: a quiet "Report this page" mailto in the foot of the three templates, and an operator switch that sets a page to `noindex` and removes it from the directory without taking it down. Verify: the link exists in the Playwright spec; the switch flips the robots meta.

**13. No llms.txt and no Markdown version.** [seo-agentic P1; ai-seo machine-readable files; seo-geo llms.txt evidence]
- Weight, stated honestly: Google says these files do not help or hurt Search, and no large assistant has confirmed reading llms.txt. They are cheap, they make the Lighthouse agent checks pass once unknown URLs 404 (finding 3), and Markdown is the cleanest thing to hand an agent. Design in section 5. Verify: `curl -sI https://foundmill.com/llms.txt` → `200`, `content-type: text/plain` or `text/markdown`.

**14. The landing page ships about 604 KB of compressed JavaScript.** [seo-technical CWV; seo-page]
- Evidence: 38 chunks, 1.77 MB raw, on a page whose first screen is a heading, a text field and a button. The target reader is young and often on a phone; INP and main-thread time are the risk. Not measured in a lab.
- Fix: measure first (PageSpeed Insights on `/`, phone). If INP or total blocking time is poor, load the below-the-fold product windows with `next/dynamic` when they scroll into view. Do not start this before the measurement. Verify: the PSI phone run; target LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1.

### P3

**15.** `/favicon.ico` → 404; many clients ask for it. Add `apps/web/app/favicon.ico` (the proxy already excludes the path). Check: `curl -sI https://foundmill.com/favicon.ico` → `200 image/x-icon`. [seo-images]

**16.** `index: true` is not tied to the environment. `/p`, `/u` and the legal pages say `index, follow` on any deployment with its own domain, and a project page's canonical comes from the API's `APP_URL`. Gate the three `index: true` values on the production origin (`canonicalOrigin(...) === APP_ORIGIN`), and assert in the Playwright spec that the canonical of a seeded page starts with the expected origin. [seo-technical]

**17.** A project page's `h1` is the pitch; the name is a `<p>`. Keep the design; add the name to the `h1` for screen readers and machines only if the founder agrees to change DESIGN §9b. The JSON-LD `name` in section 3.1 covers the machine side without touching the design. [seo-page]

**18.** Not-found answers for `/p`, `/u`, `/m` are correct (`404`, `noindex`) but the HTML is Next's error shell: `<html id="__next_error__">` with no `lang`, an empty `<body>`, the title "Foundmill" (the page's "Page not found" title is not applied) and an `og:image` that points to a 404. A reader without JavaScript sees a blank page. Low value to fix; if wanted, return the 404 from a route-level check instead of `notFound()` inside the page. [seo-technical JS rendering]

**19.** `api.foundmill.com/` and `ingest.foundmill.com/` answer `200 application/json` with no `X-Robots-Tag`, and have no robots.txt. Add `X-Robots-Tag: noindex` to every response of the API, ingest and stream hosts. Check: `curl -sI https://api.foundmill.com/ | grep -i x-robots-tag`. [seo-technical]

**20.** Small address hygiene: `http://www.foundmill.com/` takes two hops (http → https www → apex); `/Terms` redirects to sign-in (fixed by finding 3, then a 404); `/p/MySlug` would answer 200 with a lowercase canonical instead of a `308` to the lowercase address (the API lowercases the slug). [seo-technical URL structure]

**21.** Metadata polish on the indexable templates: `robots.googleBot: { "max-image-preview": "large", "max-snippet": -1 }`; `openGraph.locale: "en_US"`; a per-page `alt` for the share image (today "A project's page on Foundmill" for every project). [seo-page, seo-images]

**22.** The story's description is one sentence shape for every project ("What {name} has done so far, each step recorded by Foundmill when it happened."). Templated metadata across a set is a quality signal of its own [seo-page, seo-programmatic]. Name the newest milestone and its date in it: "{name}: {latest milestone} on {date}, and how it got there. Each step recorded by Foundmill when it happened." No count is added.

---

## 3. The public page templates

### 3.0 What each template emits today, and what is missing

**Root layout, `apps/web/app/layout.tsx`**

| Item | Today | Missing or wrong |
| --- | --- | --- |
| `metadataBase` | `https://foundmill.com` (`APP_ORIGIN`) | Nothing |
| Title | default "Foundmill", template `%s · Foundmill` | Nothing |
| Robots default | `noindex, nofollow` | Keep: it is the right default for an app. Pages opt in. |
| Open Graph default | title, description, site name, type; image from `app/opengraph-image.png` | A child page that sets `openGraph` loses the image (finding 10) |
| JSON-LD | none | `Organization` and `WebSite` belong on `/` only, not here (the layout also wraps the signed-in app) |
| `<html lang>` | `en` | Fine. English only, so no hreflang [seo-audit international: not applicable] |

**Landing page, `apps/web/app/page.tsx` (and `app/examples/[id]/page.tsx`)**

| Item | Today | Should be |
| --- | --- | --- |
| Title | "Foundmill" | "Foundmill: Build a real business with a team of AI agents" |
| Description | 47 characters, same as the `h1` | About 150 characters that say what it does and who decides (finding 1) |
| Robots | `noindex, nofollow` | `index, follow` on `/` only; `/examples/*` stay noindex |
| Canonical, `og:url` | none | `/` |
| JSON-LD | none | `Organization`, `WebSite`, `SoftwareApplication` (3.1) |
| Copy for machines | No definition, no price, example figures unmarked | Finding 9 |
| In sitemap | no sitemap | yes |

**Project page, `apps/web/app/p/[slug]/page.tsx` with `packages/dugout/src/components/public/ProjectPage.tsx`**

| Item | Today | Missing |
| --- | --- | --- |
| Title | `{name}: {pitch}` cut at 70 characters at a word (`pageTitle`) | Nothing. Note for founders and agents: a pitch over about 55 characters is cut. |
| Description | first 160 characters of "about", else the pitch (`pageDescription`) | Nothing in code; the first sentence of "about" must stand alone (section 5.4) |
| Canonical | `page.url` = the API's `APP_URL` + `/p/<slug>` | A test that it is the production origin (finding 16) |
| Robots | `index, follow` whenever published | The listing rule (3.3) |
| Open Graph | title, description, url, site name, type `website`; image from `opengraph-image.tsx` (1200 × 630, brand colors, name, pitch, stage) | `locale`; per-project `alt` |
| Twitter | `summary_large_image`, image falls back to the Open Graph file | Nothing |
| JSON-LD | none | `ProfilePage` + `Project` or `Organization` + `BreadcrumbList` (3.1) |
| Headings | `h1` = pitch; name in a `<p>`; `h2` "Who it is for"; "about" is a labeled section with no heading | Finding 17 |
| Dates | "Published Oct 7, 2026" in a `<span>` | A `<time datetime>`, and "Updated {date}" when the published copy changed later |
| Facts | stage chip, "Built by …" (optional) | Kind of business, place, a link to the project's own site (section 4 and 5) |
| Links | the mark only (free plan, signed-out) | Story, founders, hubs (finding 4) |
| Private or taken down | `publicPage.bySlug` returns null → `notFound()` → 404; the same answer as an unknown address; sample businesses are not in the view | Correct. Nothing leaks. |
| Freshness | `force-dynamic`, `no-store`: a take-down is a 404 on the next request | Keep |
| In sitemap | no | yes, when listed |

**Story, `apps/web/app/p/[slug]/story/page.tsx` with `ProjectStory.tsx`**

| Item | Today | Missing |
| --- | --- | --- |
| Title | "How {name} was built" | Nothing |
| Description | one templated sentence | Finding 22 |
| Canonical, robots | self; `index, follow` while at least one milestone is shown; otherwise 404 | Index only with two or more shown milestones (a story that is only "Page live" is one line) |
| Share image | the project page's image, named explicitly | Nothing |
| Markup | one `h1`, an `<ol>` with an `h2` and a `<time datetime>` per milestone, "Verified by Foundmill" | Good as it is: dated, first-party facts in real HTML |
| JSON-LD | none | `WebPage` with `about` → the project, `dateModified` = newest shown milestone, `BreadcrumbList` |
| In sitemap | no | yes, when indexable |

**Key file, `apps/web/app/p/[slug]/[keyFile]/route.ts`**

It serves one thing: the IndexNow key file `/p/<slug>/<key>.txt` (key of 8 to 128 letters, digits and dashes), as `text/plain` with `X-Robots-Tag: noindex` and `no-store`, only while the page is public and that project connected IndexNow for its hosted page with that key. Everything else is `404` (live check: `/p/does-not-exist/abcdefgh12345678.txt` → `404`, `x-robots-tag: noindex`); an API failure is `503` with `Retry-After: 60`. It serves **no llms.txt** (the name fails the key rule) and **no search-engine verification file** (only `.txt` keys). Keep the second as it is: a Search Console URL-prefix property for `https://foundmill.com/p/tutor` would also cover `/p/tutorlane`, so a founder verifying a prefix on the shared host could read another project's search data. Section 6 has the safe way to give founders search data.

**Milestone card, `apps/web/app/m/[id]/page.tsx`**

| Item | Today | Missing |
| --- | --- | --- |
| Title, description | "{milestone}: {name}"; "{name} reached this on {date}. Verified by Foundmill." | Nothing |
| Robots | `noindex, follow`, self canonical | Correct by design (DESIGN §9f). Never in the sitemap. |
| Share images | wide 1200 × 630 (`opengraph-image.tsx`), tall 1080 × 1920 (`/m/<id>/story-image`) | Nothing. This is the share surface; it works. |
| JSON-LD | none | None needed on a page that is not indexed |

**Person page, `apps/web/app/u/[handle]/page.tsx` with `PersonPage.tsx`**

| Item | Today | Missing |
| --- | --- | --- |
| Title | `{name}: {headline}` or the name | Nothing |
| Description | start of "about", else the headline, else "{name} on Foundmill" | The fallback is the sign of a thin page: do not index it (3.3) |
| Canonical, robots | self; `index, follow` whenever public | The listing rule |
| Open Graph | type `profile`, image with initials, name, headline, place | Nothing important |
| JSON-LD | none | `ProfilePage` + `Person` (3.1) |
| Headings, links | `h1` = name; `h2` "Good at", "Wants to learn", "Projects"; each project links to `/p/<slug>` | Links to place and strength hubs once they exist |
| In sitemap | no | yes, when listed |

### 3.1 The JSON-LD each template should emit

One helper, used by every template (new file `apps/web/components/public/JsonLd.tsx`). The escape matters because founders write the text:

```tsx
/** One JSON-LD block. "<" is escaped so text a founder wrote can never close the script element. */
export function JsonLd({ data }: { data: object }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
```

The site's CSP already allows it (`script-src 'self' 'unsafe-inline'`), and a data block does not execute. Rules for every graph [seo-schema, marketing-skills:schema; and the GEO agent's own guardrail "structured data describes what is true on the page"]: only facts that are visible on the page; absolute URLs; ISO 8601 dates; no ratings, reviews, offers or FAQ markup unless the page shows them; no `FAQPage` or `HowTo` for a Google result (both retired).

**Home `/`**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "Organization", "@id": "https://foundmill.com/#org", "name": "Foundmill", "url": "https://foundmill.com/",
      "logo": "https://foundmill.com/brand/foundmill-icon-512.png",
      "description": "Foundmill is a web app where one person works with a team of AI agents to build and run a real business." },
    { "@type": "WebSite", "@id": "https://foundmill.com/#website", "name": "Foundmill", "url": "https://foundmill.com/",
      "inLanguage": "en-US", "publisher": { "@id": "https://foundmill.com/#org" } },
    { "@type": "SoftwareApplication", "@id": "https://foundmill.com/#app", "name": "Foundmill", "url": "https://foundmill.com/",
      "applicationCategory": "BusinessApplication", "operatingSystem": "Web",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
      "publisher": { "@id": "https://foundmill.com/#org" } }
  ]
}
```

Notes: the logo file exists (`/brand/foundmill-icon-512.png` → 200). Add `sameAs` only when real profiles exist. The company's legal name stays off this page (founder, Nov 13, 2026: it appears on the two legal pages only). The `Offer` of 0 is true while the free plan with included credits exists (`TIERS.free` in `packages/config/src/pricing.ts`). `WebSite` is what gives Google the site name; the sitelinks search box is retired, so no `SearchAction`.

**Project page `/p/<slug>`** (values shown are examples)

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "ProfilePage", "@id": "https://foundmill.com/p/northwind-skincare#page",
      "url": "https://foundmill.com/p/northwind-skincare",
      "name": "Northwind Skincare: A skincare routine for reactive skin",
      "description": "<the meta description>",
      "inLanguage": "en-US",
      "dateCreated": "2026-10-07T09:12:00Z", "dateModified": "2026-11-12T16:40:00Z",
      "isPartOf": { "@id": "https://foundmill.com/#website" },
      "mainEntity": { "@id": "https://foundmill.com/p/northwind-skincare#project" } },
    { "@type": "Project", "@id": "https://foundmill.com/p/northwind-skincare#project",
      "name": "Northwind Skincare",
      "description": "<the pitch>",
      "url": "https://foundmill.com/p/northwind-skincare",
      "image": "https://foundmill.com/p/northwind-skincare/opengraph-image",
      "founder": [{ "@type": "Person", "name": "Maya Okafor", "url": "https://foundmill.com/u/maya-okafor" }] },
    { "@type": "BreadcrumbList", "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Foundmill", "item": "https://foundmill.com/" },
      { "@type": "ListItem", "position": 2, "name": "Projects", "item": "https://foundmill.com/projects" },
      { "@type": "ListItem", "position": 3, "name": "Northwind Skincare" } ] }
  ]
}
```

- `@type`: `Project` while the stage is "Idea" or "Being built", `Organization` once it is "Live". This is the product's own rule (a project until its first sale, a business after) in schema.org's words; `Project` is a subtype of `Organization`, so Google's profile-page rule (main entity is a person or an organization) holds. Check it once in the Rich Results Test; if the test rejects `Project`, use `Organization` for every stage.
- `founder` only when the page names its founders; `url` only when that person's profile is public.
- `dateModified` needs a column the table does not have: `published_at` is kept when a page is republished ("Live since" does not move) and `updated_at` moves on every draft save. Add `content_published_at`, set on each publish that changes the published copy. The sitemap's `lastmod` needs the same value.
- Leave out the "Projects" crumb until `/projects` exists (two items are enough).
- Add `sameAs` (the project's own site and profiles) and `Product` or `Service` with an `Offer` only when the page shows them. Today it shows neither.

**Story `/p/<slug>/story`**: `WebPage` (`name`, `url`, `description`, `dateModified` = the newest shown milestone, `isPartOf` → website, `about` → `…#project`) and a `BreadcrumbList` (Foundmill › Projects › {name} › How it was built). `Article` is the wrong type today: the page is a list of dated facts with no body text. When the planned project log exists (NETWORK §8 "story, log, roles"), each log entry is a `BlogPosting` with the founder as `author`.

**Person `/u/<handle>`**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "ProfilePage", "@id": "https://foundmill.com/u/maya-okafor#page", "url": "https://foundmill.com/u/maya-okafor",
      "name": "Maya Okafor: Tutor building tools for tutors", "inLanguage": "en-US",
      "dateCreated": "2026-10-07T09:12:00Z", "dateModified": "2026-11-02T18:40:00Z",
      "isPartOf": { "@id": "https://foundmill.com/#website" },
      "mainEntity": { "@id": "https://foundmill.com/u/maya-okafor#person" } },
    { "@type": "Person", "@id": "https://foundmill.com/u/maya-okafor#person", "name": "Maya Okafor",
      "description": "<the headline>", "url": "https://foundmill.com/u/maya-okafor",
      "knowsAbout": ["Teaching", "Writing"],
      "homeLocation": { "@type": "Place", "name": "Austin, Texas" } }
  ]
}
```

Only what the person published: no email, no age, nothing from the account. "Wants to learn" and "What are you here for" stay out of the markup.

**Milestone card, legal pages, sign-in:** no JSON-LD. **FAQPage:** do not add it for a search result. If a visible FAQ is added to `/` or `/pricing` it helps readers and other assistants as plain HTML; markup is optional and earns nothing in Google.

### 3.2 Sitemap and robots for thousands of pages with mixed visibility

**Robots, by state** (one rule, `isListed`, section 3.3):

| State of a project page | HTTP | Robots meta | In sitemap | In the directory |
| --- | --- | --- | --- | --- |
| Draft, never published, or taken down | 404 | `noindex` (automatic) | no | no |
| Published, founders chose "link only" (new switch) | 200 | `noindex, follow` | no | no |
| Published, not yet over the gate | 200 | `noindex, follow` | no | no |
| Published and listed | 200 | `index, follow` | yes | yes |
| Sample business | not in the view | n/a | no | no |
| Old address after a change (finding 7) | 308 → new | n/a | no | no |

The same table applies to a person page. A milestone card is always `noindex, follow`. A take-down needs no robots.txt rule: the page is a 404 on the next request and drops out of the sitemap in the same read.

**The switch.** Today "published" means public and indexable in one step. Add one field to the published copy, `listed` (default on), with the label "Let search engines and the Foundmill directory show this page". Off means anyone with the link can open it and nothing lists it. The publish dialog should say in plain words that a listed page can be found by search engines and AI assistants (the Terms already say "search engines may index it").

**Sitemap.**

- Now: one `apps/web/app/sitemap.ts` with `export const revalidate = 3600`. It returns `/`, `/terms`, `/privacy`, then every listed project page, every indexable story and every listed person page, each with `lastModified` (project: `content_published_at`; story: newest shown milestone; person: the profile's last public save). No `priority`, no `changefreq` (ignored). Only canonical, 200, indexable addresses.
- Data: a new signed-out API read, `publicPage.listed({ cursor, limit })`, on the service connection over `public_project_pages` and `public_person_profiles`, returning slug or handle and the date only, paged by 5,000. It lists only what the founders chose to list, so it enumerates nothing that is not already meant to be found. Rate-limit it per caller like the other public reads.
- At about 25,000 addresses: split with `generateSitemaps` into `/sitemap/static.xml`, `/sitemap/projects-<n>.xml`, `/sitemap/people-<n>.xml` (the limit is 50,000 addresses or 50 MB per file), and serve an index at `/sitemap.xml`. Check in the Next 16 docs whether the index is generated; if not, a small route handler writes it. In Next 16 the `id` is expected to arrive as a promise (check the upgrade notes). **The proxy must let the new paths through:** add `sitemap/` beside `sitemap.xml` in the `proxy.ts` matcher and `"/sitemap/"` to `PUBLIC_PREFIXES`, or the child sitemaps will redirect to sign-in.
- Roll out in batches [seo-programmatic]: the first 50 to 100 listed pages, then watch Search Console's "Crawled, currently not indexed" share for two to four weeks before the gate is loosened.
- Submit `/sitemap.xml` once in Google Search Console and Bing Webmaster Tools (a founder task: verification is a DNS record and accepting terms).

### 3.3 The listing rule ("only pages with real, approved content are indexable")

One pure function in `packages/shared/src/project-page.ts`, called by the API when it builds the public view, so the page, the sitemap and the directory read one boolean:

- **Approved** means: an owner or admin pressed Publish, the deterministic hold passed (no personal data, no markup), the business is committed, not archived and not a sample. All of this exists today.
- **Real content** means, as a starting rule to tune with Search Console data: "about" is at least 400 characters; the pitch is not just the name; the text is not the same as another listed page's; and for a person, a headline plus either 200 characters of "about" or one listed project.
- **Listed** = approved and real content and the founders' `listed` switch is on and no operator hold (finding 12).
- The console says why a page is not listed yet, as an offer and never as a fault: "Search engines can show this page once it says a little more about the project."

### 3.4 Canonical and duplicate rules: Foundmill address and a founder's own domain

1. **One address per project on Foundmill:** `https://foundmill.com/p/<slug>`, lowercase, no trailing slash, self canonical. `?via=…` and any other parameter never change the canonical (true today). Uppercase or trailing-slash variants redirect with `308`.
2. **Story, card, key file:** the story is self canonical. The card is `noindex`. Markdown and text versions (section 5) send `X-Robots-Tag: noindex` and `Link: <page>; rel="canonical"`.
3. **A founder's own domain that shows the same page** (Foundmill serves the page on their domain): the founder's domain is the canonical. The Foundmill address stays `200`, keeps working forever, and carries `<link rel="canonical" href="https://their-domain/">`; it leaves Foundmill's sitemap and the founder's domain serves its own `robots.txt` and `sitemap.xml`. Use a canonical, not a redirect: a young founder's domain will lapse or be misconfigured at some point, and the day it is disconnected the canonical flips back and the page is still there. A redirect would strand every link.
4. **A founder's own domain that is a different site** (their product, their shop): no duplicate exists. The Foundmill page stays self canonical and gains a "Visit {name}" link and `sameAs`. Link with `rel="nofollow ugc"` until the founder proves they own the domain (a DNS record), then as a normal link.
5. **Never canonical one project to another, and never to the home page.** A project that moves address gets a `308` (finding 7).
6. **Foundmill's own duplicates:** `/examples/*` and `/?example=…` stay `noindex`; `www` stays a `308` to the apex.

---

## 4. The network as a search asset

Sources: `marketing-skills:site-architecture` (hierarchy, URL map, link rules), `marketing-skills:programmatic-seo` (Directory and Profiles playbooks: product-derived data is the defensible kind), `claude-seo:seo-programmatic` (gates). It fits what `docs/NETWORK.md` already plans (indexable community front pages `/c/<slug>`, an indexable starting-points gallery `/start-from/<slug>`) and what it rules out (§15: no rankings, no "top", no trending, no counts on a person or a project, no invented activity; the weekly "Shipped" page was declined on Nov 12).

### 4.1 Hierarchy

```
Foundmill (/)
├── Projects (/projects)                          every listed project, newest first, paged
│   ├── By kind   (/projects/kind/<kind>)         for example /projects/kind/education
│   ├── By place  (/projects/in/<place>)          for example /projects/in/austin-tx
│   ├── By stage  (/projects/stage/<stage>)       idea, being-built, live
│   └── a project (/p/<slug>)                     exists
│       └── its story (/p/<slug>/story)           exists
├── People (/people)                              every listed person, paged
│   ├── By place  (/people/in/<place>)
│   ├── By skill  (/people/good-at/<skill>)
│   └── a person  (/u/<handle>)                   exists
├── Communities (/c/<slug>)                       planned, NETWORK F14
├── Starting points (/start-from/<slug>)          planned, NETWORK F11
├── Pricing (/pricing) · About (/about)           new, section 7
└── Terms (/terms) · Privacy (/privacy)           exist
```

Why words (`/projects`, `/people`) and not `/p` and `/u`: the short prefixes are share links; hubs are read in a results page and in a breadcrumb. Nothing collides with a slug, because hubs do not live under `/p/` or `/u/`.

**Milestones** are in the directory as facts, not as pages: a project's card on a hub shows its newest verified milestone and the date ("First follower · Nov 12, 2026"), and the story is the indexable page. No milestone feed and no "reached this week" page: that is the declined "Shipped" page under another name. Cards (`/m/<id>`) stay unindexed.

### 4.2 URL map

| Page | URL | Parent | Indexable | Where it is linked |
| --- | --- | --- | --- | --- |
| Projects | `/projects` | Home | Yes, once about 20 projects are listed | Footer of `/`, breadcrumb of every project |
| Kind hub | `/projects/kind/<kind>` | Projects | Only with 5 or more listed projects | `/projects`, each project's kind chip |
| Place hub | `/projects/in/<place>` | Projects | Only with 5 or more | `/projects`, each project's place |
| Stage hub | `/projects/stage/<stage>` | Projects | Only with 5 or more | `/projects`, each project's stage chip |
| Project | `/p/<slug>` | Projects | When listed | Its hubs, its founders' pages, its story |
| Story | `/p/<slug>/story` | Project | With 2 or more shown milestones | The project page (every plan), cards |
| People | `/people` | Home | Once 20 people are listed | Footer of `/` |
| People hubs | `/people/in/<place>`, `/people/good-at/<skill>` | People | Only with 5 or more | `/people`, each person's place and chips |
| Person | `/u/<handle>` | People | When listed | Their projects' pages, their hubs |

The numbers 20 and 5 are starting thresholds, to be tuned with Search Console data.

**Data this needs that does not exist:** a project has no kind and no place today (the public view has the slug, the published copy, the date, the name, the logo version, the colors and the founders' names). Add two optional fields to the published copy: `kind`, chosen from a short fixed list (a fixed list, so hubs cannot multiply), and `place`, picked from a known list of places, not free text. A person's `place` is free text of up to 60 characters today and skills are free tags; map both to a known list before they become hub addresses, and keep what the person typed as the display text.

### 4.3 Internal-link rules

1. Every listed project is linked from `/projects`, from each hub it belongs to, from each named founder's page and from its own story. Every listed person is linked from `/people`, their hubs and the projects that name them. No page is listed without at least two of these.
2. A project page links to: its story ("How {name} was built", on every plan), each named founder with a public profile, its kind and place hubs (as the breadcrumb and chips), and `/projects`.
3. A person page links to its projects (exists), its place hub and its skill hubs.
4. The home page links to `/projects` and `/people` in the footer. When real projects exist, it may show a few of them, chosen by date, never by a score.
5. Order is newest published first, or alphabetical. Never "top", "popular" or "trending", and no counts (NETWORK §15).
6. Link text is the name or a plain phrase ("Education projects", "People in Austin"), never "click here" and never a repeated keyword.
7. Only the "Built on Foundmill" mark carries `?via=`. Hub and breadcrumb links are clean addresses.
8. Paging: real links to `/projects?page=2`, each page self canonical; no "load more" without an address behind it.
9. A hub never asks a solo founder to find a partner. "Open to building with people" is a filter a person chose to appear in, not a label on anyone else.

### 4.4 Thin-content safeguards

- **One predicate** (3.3) decides the page's robots meta, the sitemap and the directory.
- **A hub exists only with enough in it:** fewer than 5 listed entries → the hub is `noindex, follow`, not in the sitemap, and its entries appear on the parent. This is NETWORK's own rule for communities ("opened only when enough members exist, otherwise folded into a wider one").
- **No crossed hubs** (kind × place, skill × place) until each side has 10 or more real entries; crossing is how doorway pages are made.
- **No written filler on hubs.** A title, one true sentence and the list. No model-written introduction per hub.
- **No invented entries.** Sample businesses and example data never appear (the view already excludes samples).
- **Batches of 50 to 100** new listed pages, with a human look at a 5 to 10 % sample [seo-programmatic], and a monthly count of indexed against submitted.
- **Near-duplicates** (the same "about" text on two pages) are not listed.
- **A report link and an operator hold** (finding 12).

### 4.5 What must never be indexed

`/m/<id>` cards; `/i/<token>` invitations; `/a/<token>` one-click answers; `/email/*`; the planned `/f/<id>` feedback links; `/login`, `/auth/*`, `/start`, `/home`, `/onboarding`, `/new/*`, `/b/*`, `/businesses`, `/public-profile`, `/network`, `/communities` (signed-in), `/integrations/*`; `/examples/*` and `/?example=…`; key files, Markdown and text versions; share-image routes; the follow-confirmation pages on the ingest host; `api.`, `ingest.` and `stream.foundmill.com`; any page of a sample business; any page that is not listed; any address that carries a token. For token pages keep `noindex` and `Referrer-Policy: no-referrer` (as `/i/<token>` does today) and do not add them to robots.txt: a blocked address can still be indexed by its URL alone, a `noindex` one cannot.

---

## 5. AI visibility

Frame [seo-geo, ai-seo]: for Google's AI Overviews and AI Mode this is ordinary SEO: be indexable, be clear, be trusted; no special file is needed. For ChatGPT, Claude, Perplexity and agents that fetch pages, clear structure and plain text help, and none of it harms Google. Nothing below promises a citation.

### 5.1 Crawler policy (a founder decision)

Live today: no robots.txt; every token tested got `200` and the whole page (GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot, PerplexityBot, Googlebot, bingbot; unverified traffic only). Three kinds of agent, never to be merged:

| Purpose | Tokens | Recommendation |
| --- | --- | --- |
| Search and answer indexes | Googlebot, bingbot, OAI-SearchBot, Claude-SearchBot, PerplexityBot, Applebot | Allow. This is where "found by search and AI assistants" happens. |
| A person's own agent fetching a page | ChatGPT-User, Claude-User, Perplexity-User, Google-Agent | Allow. Some ignore robots.txt anyway; private things are behind sign-in already. |
| Model training | GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended, Bytespider, meta-externalagent | The founder's choice. Blocking does not remove pages from search or answers (Google-Extended also covers Gemini's grounding). |

Two honest options for training: **(A) allow everywhere**, the most presence for a new name with no footprint; or **(B) allow on Foundmill's own pages and disallow on `/p/` and `/u/`**, which matches the spirit of "we do not use your content to train AI models" for founders' words. Either way, say it in the Terms next to "search engines may index it". The one-group robots.txt in finding 2 is option A; option B adds one named group per training token with `Disallow: /p/` and `Disallow: /u/` (a named group replaces the `*` rules for that bot, so repeat `Disallow: /api/` and `/b/` in it).

### 5.2 Site-level `/llms.txt`

File: `apps/web/app/llms.txt/route.ts`, a static `GET` returning `text/plain; charset=utf-8`; add `"/llms.txt"` to `PUBLIC_PREFIXES` and to the `proxy.ts` matcher's exclusions. Draft (US English, the product's words; a link is listed only when the page exists):

```
# Foundmill

> Foundmill is a web app where one person works with a team of AI agents to build and run a real business. The team shapes the idea, builds the product, finds customers and keeps the books. The founder sets the direction and makes every decision that moves money or signs anything.

Facts:
- For: people starting their first business, alone or with cofounders. 18 or older.
- Cost: free to start with included credits and no card. Paid plans are not open yet.
- Every project gets a free public page at foundmill.com/p/<name>, and can show verified milestones.
- Agents never move money, sign, accept terms or file anything in the founder's name.

## Pages
- [Home](https://foundmill.com/): what Foundmill is and an example business
- [Projects](https://foundmill.com/projects): public projects built on Foundmill
- [People](https://foundmill.com/people): public profiles of people building on Foundmill
- [Terms of Service](https://foundmill.com/terms)
- [Privacy Policy](https://foundmill.com/privacy)

## For agents
- A project's facts as Markdown: https://foundmill.com/p/<slug>/index.md
- Example businesses on the home page (Tutorlane, Glitchwick, Northwind Skincare) are examples, not customers.
```

The last line matters: it is the cheapest guard against an assistant citing the example's figures as real.

### 5.3 Per-project Markdown and `llms.txt`

Serve both from the route that already owns `/p/<slug>/<file>` (`app/p/[slug]/[keyFile]/route.ts`): match the two fixed names before the key check. `index.md` is the page as Markdown; `llms.txt` is the same text (the llms.txt proposal allows a file in a subpath; no crawler is known to look there, so do not promise founders anything from it). Headers: `content-type: text/markdown; charset=utf-8`, `x-robots-tag: noindex`, `link: <https://foundmill.com/p/<slug>>; rel="canonical"`, `cache-control: no-store`. A page that is not public answers the same `404` as today. Add `<link rel="alternate" type="text/markdown" href="/p/<slug>/index.md">` to the page head. `Accept: text/markdown` negotiation can come later, with `Vary: Accept`; the fixed address is enough to start [seo-agentic "Markdown via .md URLs or Accept"].

```
# Northwind Skincare

> A skincare routine for reactive skin, made with contract labs and sold online.

- Stage: Being built
- Kind: Consumer brand
- Place: Portland, Oregon
- Published: Oct 7, 2026 · Updated: Nov 12, 2026
- Built by: Maya Okafor (https://foundmill.com/u/maya-okafor)
- Page: https://foundmill.com/p/northwind-skincare

## About
<the "about" paragraphs, as written>

## Who it is for
<the text, when there is one>

## Milestones (recorded by Foundmill when they happened)
- Oct 7, 2026: Page live
- Nov 12, 2026: First follower

Source: written and published by the project's founders on Foundmill. Milestones are recorded by Foundmill, not typed in.
```

Everything in it is already public on the page or the story; nothing new is exposed. The text is the founders' own, so the usual checks (no personal data, no markup) already ran at publish.

### 5.4 What makes a project page citable

Asked "what is {project}?", an assistant today gets from the page: the name (title and a `<p>`), a one-line pitch (`h1`), up to 1,500 characters of "about", optionally who it is for, the stage, a publish date, and optionally the founders' first names. It does not get: what kind of business it is, where it is, whether the page is current, who the founders are beyond a name, the project's own site, or any machine-readable fact. In order of effect:

1. **Reachable and listed:** indexable, in the sitemap, linked from a hub (findings 2, 4, 6). Nothing else matters before this.
2. **A first sentence that stands alone.** The meta description is the first 160 characters of "about", and it is what gets quoted. Change one line of the draft prompt (`packages/agents/src/prompts/project-page.ts`, the `about` rule): "The first sentence names the project and says what it is and who it is for, in plain words, so it makes sense when quoted on its own." Add an eval for it.
3. **Visible facts:** kind, place, stage, published and updated dates, built by, as a short list on the page, with the same facts in JSON-LD. Assistants that read raw HTML use the visible text; Google uses both.
4. **Dated, verified history.** "Verified by Foundmill" milestones are first-party facts nobody else has. This is the product's real edge for being cited: show the newest one on the project page itself, not only on the story.
5. **Freshness:** "Updated {date}" and `dateModified`.
6. **Identity:** founders linked to their public pages; a link to the project's own site once it has one.
7. **The same description everywhere** the project appears (the GEO agent's entity work).
8. **Mentions the founder earns** elsewhere. No shortcut exists, and inauthentic mentions are a spam policy matter.

For Foundmill itself the same list applies: finding 9's definition block, a price page, a named maker, the `Organization` graph with real `sameAs` profiles, and presence on the launch directories that fill the first results for its head query (section 1).

### 5.5 Measuring it

No tool is needed to start [ai-seo "DIY monitoring"]: 20 prompts across four kinds (problem, category, name, comparison), each run 3 to 5 times on each assistant the founder uses, logged monthly as a rate with its sample size ("named in 2 of 5"). One run is an anecdote. There is no AI report in Search Console.

---

## 6. The founder-facing SEO and GEO agents

### 6.1 What they hold today (from the code)

- **SEO Engine** (`packages/agents/src/templates/channels/seo.ts`): `github` (read repositories, open and read pull requests), `serpapi` (search results), `firecrawl` (read one page as Markdown), `indexnow` (submit addresses; asks first), plus the platform set every channel has (tasks, messages, `inbox.request_human_action`, `memory.search`, `docs.read`, `assets.request_approval`, `kit.create_founder_task`, `budgets.read`, `crm.entities.search`, consent and suppression checks) and `quarantine.read_untrusted`. No `web` search or fetch tool.
- **GEO Engine** (`geo.ts`): the same, plus `panel.query` on `anthropic`, `openai`, `gemini` and `perplexity`. The Anthropic panel runs on the project's own Anthropic key or the included credits; the other three need the founder's key at that vendor.
- `serpapi`, `firecrawl`, `indexnow`, `openai`, `gemini` and `perplexity` run only on the founder's own key (DECISIONS 2026-11-12). Not connected means "not connected".
- No Search Console, Bing Webmaster, keyword-volume or page-speed tool exists (`templates/PLANNED_GRANTS.md`: "connector not built"), and the templates say so honestly.
- **The gap that matters:** both channels can act only through `github:commit_files` (`CHANNEL_ACTING_TOOLS` in `packages/connectors/src/channel-availability.ts`), and a channel that cannot act is not on the Channel Board. A week-one project has a Foundmill page and no repository, so **for the one page every founder has, the SEO and GEO agents can do nothing and are not offered.** They have no tool to read the published page and none to propose a change to it. The templates' playbooks and examples ("PR #91 adds canonicals (38 pages…)") assume an existing site.

### 6.2 Two small tools that close the gap

1. `platform:read_public_page`: returns this project's published page and story (title, description, the fields, dates, whether it is listed and why not). Read-only.
2. `platform:propose_page_edit`: writes a draft to Product › Public page with a note of what changed and why. Nothing is public until an owner or admin presses Publish, so no rule changes. Count it as the acting tool for `seo` and `geo` on a hosted page, so the channels can open without a repository.

Structured data, canonical, sitemap and Markdown for hosted pages come from the template (section 3), so an agent never needs a pull request for them.

### 6.3 Week one, no budget, no Search Console: the checklist

For a project whose only site is `/p/<slug>`. "Today" is what the agent can do with tools it holds now; where it cannot, the step becomes a founder task with the exact words, never a claim that it was done.

| # | Step | Tool today | If the tool is missing |
| --- | --- | --- | --- |
| 1 | Read the page as published: title (`{name}: {pitch}`, cut at 70), description (first 160 characters of "about"), stage, dates | `firecrawl.scrape_page` on the page's own address, if the founder connected it | Needs `read_public_page`. Until then, ask the founder to paste the page link in a message and work from the stored draft in memory. |
| 2 | Check the pitch: says what it is and for whom, the kind of business near the front, 55 characters or fewer so the title is not cut | none needed | Send the proposed line with the reason by `messages.request` |
| 3 | Check the first sentence of "about": names the project, says what it is, makes sense alone | none needed | The same message; with `propose_page_edit`, a draft the founder publishes |
| 4 | Fill "Who it is for" if empty; propose kind and place when those fields exist | none needed | The same |
| 5 | Name check: does a search for the project's name show something else with that name? | `serpapi.search_google`, if connected | `kit.create_founder_task`: "Search your project's name in a private window. Tell me the first five results." |
| 6 | Write the entity pack once and store it: name, one line, 40 words, 100 words, founders, place, stage, the page address. Every later text uses it word for word. | `memory` | none |
| 7 | Write 10 questions a customer would ask an assistant (4 about the problem, 3 about the kind of product, 3 with the name). Run each 3 times; report the rate with the sample size, labeled approximate, naming the assistant. | `panel.query` on `anthropic` (included credits or the project's key; say what it cost, labeled Estimate) and on any other assistant the founder connected | Report "not connected" for the rest; never estimate |
| 8 | Ask the founder to show "Page live" on the page, so the story exists | `kit.create_founder_task` | none |
| 9 | Ask the founder to publish their public profile and turn on "show who is building it", so the person page and the project page link to each other | `kit.create_founder_task` | none |
| 10 | Tell search engines the page changed | `indexnow.submit_urls` (asks first), if connected for the hosted page | Founder task with the steps to create a key. See finding 8: this may not cover the page until the platform key exists. |
| 11 | First links, all the founder's own and free: the page link in the bio of each profile they already have; a post from the share panel when a milestone is reached | `kit.create_founder_task` with the copy from the entity pack | none |
| 12 | Up to three free listings that fit the kind of business. The agent prepares the text; the founder submits, because creating an account and accepting terms are the founder's. | `kit.create_founder_task` | none |
| 13 | Day 7 report: what changed on the page, confirmed followers and where they came from (Customers, source "Public page"), the answer rate from step 7 with its sample size, and what is not known: impressions, clicks and whether the page is indexed. | platform reads | Founder task: "Search `site:foundmill.com/p/<slug>` and tell me if the page shows." |

Never in week one: keyword volumes or difficulty (no tool: say "not available", never a number), promises about rankings or citations, bought links, fake reviews, seeded forum posts, mass directory submissions, scraping against a site's terms, markup for things the page does not show.

**Search data for founders, safely.** Do not let a founder verify a Search Console property on the shared host (section 3.0). Foundmill verifies the one domain property and, when the `search_console` connector is built, the platform exposes each project's own rows only (query data filtered to the exact addresses `/p/<slug>` and `/p/<slug>/story`) as a platform read. That is Foundmill's own data about its own host, shared per project.

### 6.4 Know-how the agents lack today that a skill should carry

A craft skill, `hosted_page_seo`, for both templates, with a blueprint and an eval:

1. **Hosted mode.** With no repository the page is the site. Which five fields exist, their limits (140, 1,500, 300 characters), and how each becomes the title, the description, the `h1`, the share image and the structured data. Nothing else can be changed, and nothing needs a pull request.
2. **Title and description arithmetic**: 70 and 160 characters, cut at a word; front-load the kind of business and who it is for.
3. **The definition sentence**, and why the first 160 characters of "about" are what a result and an assistant show.
4. **The crawler taxonomy**: search, user-triggered and training crawlers are three things; blocking a training crawler does not remove a page from answers. `geo.ts` lists "llms.txt" as work with no caveat: the skill must say that Google ignores it and no assistant has confirmed reading it.
5. **What is retired or renamed**: no `HowTo`; `FAQPage` earns no Google result since May 7, 2026; INP, never FID; no sitelinks search box. `seo.ts` and `geo.ts` say "schema" without these limits.
6. **Measuring assistants honestly**: answers vary from run to run; report a rate with its sample size, name the assistant, never call it market share (the guardrail exists; the method does not).
7. **Week-one measurement without Search Console**: real outcomes first (a confirmed follower, a reply), then what the founder can check by hand. Rankings are a leading sign, labeled so.
8. **The listing rule** (3.3): why a page may not be listed yet and what to add, said as an offer.
9. **Shared-host manners**: a spammy page hurts every founder on the host; no keyword stuffing, no doorway text, no copied text.
10. **Free, legitimate first links** for someone with no budget: their own profiles, their own posts, people they already know, a few listings that fit. What the agent prepares and what only the founder may do (accounts, terms, anything in their name).
11. **Name collisions**: how to read a results page for the project's name, and when to suggest adding the kind or the place to the pitch.
12. **Own domain later**: the canonical rules of section 3.4, so the agent never recommends copying the page to a second address.
13. **Words**: US English, plain language, "project" until the first sale, never jobs or employment as the reason to build, never a nudge toward a partner.

Also fix in the templates themselves: the SEO example assumes 38 pages and a pricing page; add a hosted-page example beside it so the agent has a pattern for the common case.

---

## 7. A 30/60/90-day plan for Foundmill itself

Sized for a product before launch with almost no traffic [seo-plan, phases cut down]. Targets are targets, not forecasts.

**Before day 1 (founder, one hour).** Decide: is the home page held out of search until sign-up opens (finding 1)? Which training-crawler option (5.1)? Run two checks this review did not: search the name "Foundmill" in a private window and note what else carries it; search `site:foundmill.com` and note what is indexed (expected: `/terms` and `/privacy` at most).

**Days 1 to 30: make the site findable and the templates right.**

1. Finding 1 (home metadata), on the day the hold ends. Check: the five curl lines.
2. Finding 2 (`robots.ts`, `sitemap.ts`) and finding 3 (real 404s). Check: curl lines; unit tests.
3. Finding 5: the `JsonLd` helper and the home graph; then the project, story and person graphs with `content_published_at`. Check: Rich Results Test and validator.schema.org on `/` and on one seeded page of each kind.
4. Findings 4 and 6: the story link on every plan, founders linked, the `listed` switch and the listing rule. Check: the Playwright specs `public-page.spec.ts` and `person-page.spec.ts`.
5. Findings 10, 15, 16, 19 (legal share image, favicon, environment gate, service hosts). Small, one change each.
6. Finding 9 (a): the definition block on the home page, and `data-nosnippet` on the example parts.
7. Founder tasks: verify the domain in Google Search Console and Bing Webmaster Tools (DNS record), submit `/sitemap.xml`, run PageSpeed Insights on `/` for a phone and keep the numbers.
8. Publish the first real project pages and person pages (the founder's own first), listed.
9. Baseline for AI visibility: 20 prompts, 3 runs each, on the assistants the founder uses; record the rate.

Day-30 targets: `/` indexed with the right title and site name; `/sitemap.xml` read without errors; every unknown address a 404; zero structured-data errors; a first measured LCP, INP and CLS.

**Days 31 to 60: say what it is, and open the directory when it is real.**

1. `/pricing` (even "Free to start; paid plans are not open yet", with the facts) and `/about` (what Foundmill is for, in the product's own words: ownership and capability; who makes it, as far as the founder wants a name public). Add both to the footer, the sitemap and `/llms.txt`.
2. `/llms.txt` and per-project `index.md` (section 5).
3. `/projects` and `/people` when 20 real pages are listed; the first kind, place and stage hubs only at 5 entries each (section 4).
4. Finding 7 (address changes redirect) and finding 12 (report link, operator hold).
5. Finding 8: the platform IndexNow key, if the founder agrees.
6. Finding 14: only if the day-30 measurement was poor.
7. Presence, done by the founder: a launch post on the directories that hold the first results for the head query (Product Hunt, Indie Hackers and the like); one short screen recording of "Watch it run" on YouTube with a full description; the same one-line and 40-word description on every profile; real `sameAs` links added to the home graph as each profile goes live.
8. The `hosted_page_seo` skill and the two tools (section 6), so each new founder's page gets the week-one pass.

Day-60 targets: at least 80 % of submitted project pages indexed (below that, tighten the listing rule before adding pages); the name query shows foundmill.com first with a correct description; the first sign-ins that arrived through `?via=p.<slug>`.

**Days 61 to 90: grow by what founders publish, and prune.**

1. More hubs as they fill; community front pages and the starting-points gallery when those features ship (NETWORK F14, F11). The gallery is the honest answer to "how do I start a {kind} business", and it is content only Foundmill has.
2. A small set of guides only where there is first-hand material: what a real first week looked like, with a founder's permission. No guide written to a keyword, none at scale, none about jobs or employment.
3. Search data per project from Foundmill's own Search Console property (section 6.3), when the connector exists.
4. A monthly review: indexed against submitted, "Crawled, currently not indexed" share, pages to unlist, the 20-prompt rate with its sample size, refused public reads (finding 11).
5. Compare pages for the named competitors only if there is a true, checkable difference to state; otherwise leave them.

Day-90 targets: the first clicks from searches that do not contain the name; project pages named in at least some answers to name prompts ("what is {project}?"); every listed page still passing the rule.

---

## Appendix A. Evidence log (commands to repeat)

```
curl -sI https://foundmill.com/                      # 200, x-nextjs-prerender: 1, HSTS, CSP, no x-robots-tag
curl -s  https://foundmill.com/ | grep -o '<meta name="robots"[^>]*>'      # noindex, nofollow
curl -s  https://foundmill.com/ | grep -c 'application/ld+json'            # 0
curl -s  https://foundmill.com/ | grep -o '<link rel="canonical"[^>]*>'    # (nothing)
curl -sI https://foundmill.com/robots.txt            # 404 text/html, x-matched-path: /404
curl -sI https://foundmill.com/sitemap.xml           # 404
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://foundmill.com/llms.txt   # 307 …/login?next=%2Fllms.txt
curl -s -o /dev/null -w "%{http_code}\n" https://foundmill.com/.well-known/security.txt   # 307
curl -s -o /dev/null -w "%{content_type}\n" -H "Accept: text/markdown" https://foundmill.com/   # text/html
curl -sI http://foundmill.com/  | grep -i location   # https://foundmill.com/
curl -sI https://www.foundmill.com/ | grep -i location   # https://foundmill.com/
curl -s  https://foundmill.com/terms | grep -o '<meta name="robots"[^>]*>'  # index, follow
curl -s  https://foundmill.com/terms | grep -c 'property="og:image"'        # 0
curl -s -o /dev/null -w "%{http_code}\n" https://foundmill.com/p/does-not-exist   # 404
curl -s  https://foundmill.com/p/does-not-exist | grep -o '<html[^>]*>'     # <html … id="__next_error__">
curl -s -o /dev/null -w "%{http_code}\n" https://foundmill.com/examples/glitchwick   # 200 (noindex)
curl -s -o /dev/null -w "%{http_code}\n" https://foundmill.com/favicon.ico  # 404
curl -s -o /dev/null -w "%{size_download}\n" -H "Accept-Encoding: br" https://foundmill.com/   # 45578
curl -s -o /dev/null -w "%{http_code}\n" -A "GPTBot/1.3" https://foundmill.com/   # 200
```

## Appendix B. Files read

`apps/web/app/layout.tsx`, `page.tsx`, `not-found.tsx`, `login/page.tsx`, `terms/page.tsx`, `examples/[id]/page.tsx`, `p/[slug]/page.tsx`, `p/[slug]/story/page.tsx`, `p/[slug]/[keyFile]/route.ts`, `p/[slug]/opengraph-image.tsx`, `p/[slug]/not-found.tsx`, `m/[id]/page.tsx`, `m/[id]/opengraph-image.tsx`, `m/[id]/story-image/route.tsx`, `u/[handle]/page.tsx`, `u/[handle]/opengraph-image.tsx`; `apps/web/proxy.ts`, `next.config.ts`, `vercel.json`, `lib/auth/redirects.ts`, `lib/public-page.server.ts`, `lib/public-person.server.ts`, `content/legal/routes.ts`, `content/legal/facts.ts`, `components/providers/DesktopOnly.tsx`; `packages/shared/src/project-page.ts`, `project-story.ts`, `person-profile.ts`, `indexnow.ts`; `packages/dugout/src/components/public/ProjectPage.tsx`, `PersonPage.tsx`, `ProjectStory.tsx`, `MilestoneCard.tsx`; `apps/api/src/services/pages.ts`, `milestones.ts`, `person-profile.ts`; migrations 0077, 0080, 0089; `packages/agents/src/templates/channels/seo.ts`, `geo.ts`, `_channel.ts`, `prompts/project-page.ts`, `skills/definitions.ts`, `skills/blueprints/channels.ts`, `templates/PLANNED_GRANTS.md`; `packages/connectors/src/channel-availability.ts`, `connectors/indexnow/tools.ts`; `packages/config/src/brand.ts`, `pricing.ts`; `docs/DESIGN.md` §9a to §9f, `docs/NETWORK.md` §5, §7, §8, §15, `docs/DECISIONS.md` (2026-11-12, connectors on the founder's own key), `docs/DEPLOY.md`, `CLAUDE.md`.

## Appendix C. Sources for the results-page check

- [Founderside Agents on Product Hunt](https://www.producthunt.com/products/founderside-agents)
- [Vora IQ on Indie Hackers](https://www.indiehackers.com/product/vora-iq)
- [Soloop on stork.ai](https://www.stork.ai/en/soloop)
- [Cofounder, moge.ai](https://moge.ai/product/cofounder)
- [Adaptive for solopreneurs](https://adaptive.ai/usecases/solopreneurs)
- [ZenBusiness launches an AI co-founder, Small Business Trends](https://smallbiztrends.com/zenbusiness-launches-ai-co-founder-to-help-entrepreneurs-start-businesses/)
- [Solo founders and AI, Fortune](https://dc.fortune.com/2026/05/18/solo-founders-ai-automation-entire-teams-entrepreneurs/)
- [How to start a business using AI, Shopify](https://www.shopify.com/blog/how-to-start-a-business-using-ai)
- [Start a business with no money, QuickBooks](https://quickbooks.intuit.com/r/starting-a-business/start-a-business-with-no-money/)
- [7 AI tools to build a one-person business, Entrepreneur](https://www.entrepreneur.com/growing-a-business/7-ai-tools-to-build-a-one-person-business-in-one-weekend/504459)
