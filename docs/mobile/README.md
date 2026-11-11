# Foundmill mobile: the Newly prompt pack

This folder is everything Newly (app.newly.app) needs to build the Foundmill iOS and Android app against the existing Foundmill backend, and everything Foundmill must do on its side. It is written for Newly's actual mechanisms as of Nov 2026: one project with many chats, Build / Plan / Ask modes, a standing `AGENTS.md` (up to 20,000 characters), project skills (`SKILL.md`, up to 100 KB each), attachments (PNG/JPG/WebP/GIF, 10 MB each, 40 per chat), a public website URL in the first prompt for look and feel, GitHub two-way sync, OneSignal for push, TestFlight from a chat card.

## What is in the pack

| File | What it is | Where it goes in Newly |
| --- | --- | --- |
| `AGENTS.md` | Standing instructions: the non-negotiables, stack, structure, how to work | The project's root (paste it in prompt 1, or commit it through GitHub sync) |
| `skills/foundmill-backend/SKILL.md` | Auth, tRPC client, every procedure the app uses, the stream protocol, the event-to-refetch table, errors, rate limits, money and dates, mentions, offline, push | Settings › Skills › + New (This project), or attach in prompt 1 |
| `skills/foundmill-design/SKILL.md` | The art direction and every token, type style, radius, timing and component anatomy, translated to React Native | same |
| `skills/foundmill-voice/SKILL.md` | Vocabulary, banned words, US English, tone, verbatim strings, notification copy | same |
| `skills/foundmill-product/SKILL.md` | What Foundmill is, the loop, navigation, every screen with contents and actions, mechanics, product rules, the start flow, the example business | same |
| `PROMPTS.md` | The ordered chat prompts, 0 to 17 plus Phase B, each with its mode and an acceptance list, and where the sequence stands | Sent one at a time |
| `BACKEND_CHANGES.md` | What Foundmill itself must add or configure for the mobile app | For the Foundmill repo, not for Newly |

## How to run it

1. **Prepare the account.** Newly has no free plan; the current plan has 200 credits. This app is large: expect several thousand credits across the sequence, and top up before the component library (prompt 2) and before the Journey (prompt 10), which are the expensive steps. Up to three chats can run at once; keep one chat per prompt and let each finish.
2. **Prepare the attachments.** From this repo: `docs/ux-audit/10-home.png`, `11-inbox.png`, `12-inbox-decision.png`, `20-finance-overview.png`, `21-team-agents.png`, `22-agent-profile.png`, `24-development-plan.png`, `25-retail-partnerships.png`, `30-settings-mode.png`, `03-onboarding.png`, `05-ideate-empty.png`; and from `apps/web/public/brand/`: `foundmill-icon-512.png`, `foundmill-wordmark-light.svg` (convert the SVG to PNG at 1200 px wide first; Newly accepts PNG, not SVG). Attach the screenshots to prompts 1, 6 and 10 as the heading says, and the icon in prompt 17.
3. **Fill in the one value.** `SUPABASE_ANON_KEY` in prompt 1 is the publishable key of the `foundermanager` Supabase project (Supabase dashboard › Project Settings › API Keys; the `sb_publishable_…` key, or the legacy anon JWT). It is public by design; it still should not be committed to this repo. Everything else (API URL, stream URL, Supabase URL) is already in the prompts.
4. **Push needs our own OneSignal app.** Create a OneSignal account and app for Foundmill before prompt 13, connect it in Newly's Integrations › Push notifications with the Organization API key, and give Foundmill's gateway the same app's id and REST API key (`ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY`, docs/DEPLOY.md). The Newly-managed OneSignal app cannot be used: Foundmill's server must be able to send to it.
5. **Send prompt 0 on Newly's Home.** It creates the project. Then send prompt 1 in the same chat, pasting `AGENTS.md` and attaching the four skills. Confirm in Settings › Skills that all four are on for the project. If the agent balks at creating skills from attachments, add them by hand: Settings › Skills › + New › Write one, name, the description line from the frontmatter, and the body.
6. **Connect GitHub early** (Integrations › GitHub, a new private repository `foundmill-mobile` under the founder's account). Then `AGENTS.md` and `.skills/` can also be edited in the repo and sync both ways, and every chat turn is versioned outside Newly.
7. **Follow `PROMPTS.md` in order.** Use the mode in each heading. After each Build step open the preview, check the acceptance list, and attach a screenshot with the next message when something is off. Prefer Ask mode to diagnose; use Restore to here rather than piling fixes.
8. **Test against the example business first.** After sign-in, tap Explore an example (Northwind Skincare). It is read-only, so decisions and Continue must be tested on a real business of the founder's own.
9. **Do the Foundmill-side work in parallel.** `BACKEND_CHANGES.md` lists it. The gating items (the Supabase redirect URL and OTP code, the API's acceptance of a native client, the device-registration procedures) are in the repo as of Nov 8, 2026; the Supabase settings still need `supabase config push` by the founder before prompt 3's sign-in test, and the push fan-out (item 4) is the remaining backend work before pushes arrive.

## Why the crawler is not enough

Newly can read a public website URL for look and feel, and the first prompt gives it https://foundmill.com. That page is the marketing landing page with a working example of the loop, so it carries the brand, the words and the Continue / note / Approve rhythm. The product itself sits behind sign-in and is desktop-only: on anything narrower than 1280 px it renders only "This needs a larger window", so there is nothing for a phone-sized crawler to learn there. The skills and the screenshots are the real source. The prompts say so to the agent.

## Things to watch

- **Newly will try to add a Newly Backend** the first time it hears "sign-in" or "shared data". The prompts and `AGENTS.md` forbid it; if it proposes one, answer "No backend of our own; follow the foundmill-backend skill."
- **Newly will try to connect the Supabase integration** when it sees a Supabase URL. Do not. That integration deploys migrations and Edge Functions into the connected project. The app needs only the anon key for auth.
- **Streaming replies** need a fetch that streams bodies. The skill tells the agent to use `expo/fetch` for the stream link and to fall back to the non-streamed procedures if that fails.
- **Native rebuilds** take minutes. Prompt 1 triggers one (URL scheme). Prompt 13 (OneSignal) triggers another. Batch anything else that touches `app.json`.
- **Credits run out mid-turn** leave the work saved; top up and send "Carry on" in the same chat.
- **Apple review** needs a demo path. The App Review note in prompt 17 points reviewers at Explore an example, which needs no onboarding. Sign-in itself needs a reviewer address that is on the invite list if `SIGNUP_ALLOWLIST` is set on production.

## Where this sits in the bigger plan (Nov 11, 2026)

Three streams of work on the Foundmill side changed what the phone has to be, and `PROMPTS.md` ("Where we are") carries the consequences:

- **The web's Phase 3 for first-time founders** (merged on main Nov 9–10): founder areas instead of a department sidebar, one opening sentence per area, the Chief of Staff on every page, a first-week timeline, empty states that say what fills them, the sample business saying it is a sample, Continue answering in one sentence, approvals that show what exactly would run. Prompt 12B catches the app up; the backend skill carries the new procedures.
- **The thesis review and rebuild roadmap** (`docs/THESIS_REVIEW.md`, recorded Nov 11 on branch `claude/vibrant-euler-uua9pw`, not on main yet): Foundmill is where founders find each other and become cofounders; the humans are People (cofounders, collaborators), a business is a project until its first sale, people are free on every plan, small screens are allowed for the outer web product, and the native app is the phone's home once it launches. The vocabulary applies to the app now (12B message E); the people side is Phase B of the prompts and waits for the backend.
- **The retention review** (Nov 10, proposals only): the return loop is the biggest gap; email is the web's phone surface, push is the app's; no daily streaks (they punish vacation); "Since you were last here" on Today; pre-revenue milestones later. Prompt 15 follows it.

Still open with the founder, and touching the app: whether ratings, Form, Agent of the week and the hire grammar stay in the founder's view (thesis §14 q7); the north star; leaderboards; the age floor. The app stays as built on those until an answer lands.

## Scope decisions already taken

- Dark only, like the web. No light theme in v1.
- Five tabs: Today, Inbox, Team, Journey, Business. Continue floats above the tab bar.
- The app is a companion today and the phone's home once it launches: departments, members, integrations, keys, danger zone, permanent deletion and incorporation submission stay on the web, each reached by a link with a sentence saying why. The web's Builder view (the engine) never appears on the phone.
- The Business tab is organized by the founder's areas (Plan, Customers, Money, Product), as the web's sidebar is; one help control per screen, the Chief of Staff.
- Mobile-only engagement additions compute only from data the API already returns and are labeled as such. No points, badges or invented numbers.
- The app's product rules, words and tokens are the web's. Where the web says "desktop only" that applies to the web app in this repo, not to this native client (see docs/DECISIONS.md, Nov 8, 2026).
