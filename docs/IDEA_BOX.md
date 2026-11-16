# The idea box (landing page, founder 2026-11-13)

The landing page's hook: a signed-out visitor types one line (or picks an interest after "Surprise me") and gets one
rated concept card before any sign-up. The card is kept through sign-in and becomes the first idea in their deck; the
profile questions come after it. The founder's words: "the most important hook we have", "aesthetically beautiful and
perfect". The design is the published canvas (Version 6): the dark Generate button with a white outline, the
placeholder that types ideas until the visitor clicks in.

## The founder's decisions (Nov 13, 2026)

| | Decision |
| --- | --- |
| Card | The whole card: name, pitch, archetype, stars now and potential, the ten ratings with their evidence, the sources. |
| Speed | First words within 2 s, the whole card within 10 s. Measured first; a faster model only if the card misses. |
| Weak idea | The honest numbers, plus one line on what would raise them. Never inflated. |
| No idea | "Surprise me" opens a row of interests; one tap drafts a card from that interest. |
| After sign-in | The visitor lands on their saved card (`/new/card/<ideaId>`); the profile questions come at the next step. |
| Other device | The sign-in email carries the card: the link claims it wherever it is opened. |
| Sign-up | Invite-only until per-account spend ceilings and reporting land; a visitor who is not on the list joins the waitlist and keeps the card (90 days). Then sign-up opens with a quiet ceiling of 200 new accounts a day (past it, the waitlist). |
| Money | At most $20 a day of model spend across all visitors; one card per browser, which it may replace up to 2 times a day ("Try another idea"); about 5 per address a day. |
| Bots | Cloudflare Turnstile (invisible) from day one, checked by the gateway. |
| Retention | A card nobody claims is deleted after 7 days (90 with a waitlist hold). The Privacy Policy says so. |
| Privacy | "Your idea stays private until you choose to share it." Sharing a card publicly is the network session's (`ideaShare.publish`); the card page leaves it a slot. |
| Typed code | The sign-in email's six-digit code can be typed on the sign-in page (any device), as well as the link. |
| Phone | The landing page's hero works from 390 px (the idea box, Surprise me, the card); the rest of the landing page stays desktop. |

## How it works

### Drafting (api, plain Hono routes, not tRPC)

`POST /idea-box/draft` with `{ prompt, interest?, turnstile, website }` (website is a honeypot). Sent by the browser
straight to the api (cross-origin, `credentials: "include"`), so the api sees the visitor's own address. Answers an
NDJSON stream:

- `{"type":"started"}` at once;
- `{"type":"partial","card":{...}}` as the card's members complete (name, then pitch, archetype, stars: from the
  stream's snapshot), then one per rating as it completes;
- `{"type":"card","card":{...},"weak":"..."|null}` at the end;
- `{"type":"error","code":"...","message":"..."}` (one of a fixed set of sentences).

Before any model call, in order: the honeypot; the body's size and the prompt's length (500 characters); Turnstile
(gateway `turnstile.verify`, mock in mock mode); the browser's cookie (one card per browser: a browser that already
holds a live draft gets that card back, `{"type":"card"}` at once, no model call; with `"again": true`, "Try
another idea", it gets a new card in its place instead, under the same token, after every check below and at most
`IDEA_BOX_REDRAWS_PER_BROWSER` = 2 a day, counted in the limit store by the token's hash: founder, 2026-11-15, WP-03
decision 3); the per-address window (5 a day,
keyed by HMAC like the public page's limits); the day's spend ceiling ($20, Estimate from the call's metered cost,
kept in the limit store; refused once spent). A refusal is a single `error` line.

The card is drafted on the platform key by the Ideation agent's single-card request (`buildSingleConceptRequest`,
with no founder profile; an interest becomes the brief "something to do with <interest>"), streamed with
`streamStructured` on `elementPath: "attributes"` so the snapshot shows the name and pitch first. Model route
`ideaBox` in packages/models routing (same model as `ideation` until measured).

The draft is stored (`idea_drafts`, below) and the browser gets the cookie `fm_idea` (an opaque 32-byte token,
httpOnly, Secure, SameSite=Lax, 7 days; `Domain` from `IDEA_COOKIE_DOMAIN`, `foundmill.com` in production so the web
reads it too). Only the token's SHA-256 (lowercase hex) is stored.

`GET /idea-box/mine` answers the browser's live card (or 204), so a visitor who comes back sees it.

### Keeping the card through sign-in

- After sign-in `/start` looks for a waiting card (`ideaBox.preview`): the browser's (`fm_idea`), the sign-in link's
  claim token (`next=/start?claim=…`, another device; it counts only within 30 minutes of a sign-in), or the one the
  person's waitlist entry holds. It sends the person to `/new/card/keep`, which shows the card and the words it was
  drafted from. Only "Keep this card" (a Server Action) claims it (`ideaBox.claim`), then `/new/card/<ideaId>`; "Not
  mine" leaves it. Both clear the cookie (security review 2026-11-13).
- The box offers two ways on (founder, 2026-11-16), both through sign-in and this same keep step: "Start building it
  now" (`/login?next=/start?claim=…`, then `/new/card/<ideaId>` and Commit) and "Shape it in the Ideation Studio" (the
  same with `then=studio`: `/start` passes it to `/new/card/keep`, whose `keepCard` then opens `/new/ideate/<ideaId>`,
  the Studio with that card highlighted, in view and focused; with no profile yet, the three questions first, which go
  on to it). On a phone that page says the Studio opens on a computer and offers to email its link.
- A visitor who chose the Studio and met the waitlist: the waitlist page's join sends `then: "studio"`, kept with the
  card (`waitlist_entries.card_then`, 0124), and `ideaBox.preview` returns it, so the first sign-in after admission, on
  any browser, goes the same way. A later join that holds another card replaces the choice with that card's.
- `claimIdeaDraft(tx, userId, tokenHash)`: in one transaction, the draft is unclaimed and live (not past `expires_at`
  unless `held_until` is later): create the idea in the person's deck (`repos.ideas.create`, `ideaFromCard` with the
  provenance `{ brief, idea_box: true }`), mark the draft claimed (`claimed_by`, `claimed_at`, `idea_id`). Claiming
  twice returns the same idea to the same person, and nothing to anyone else.
- Not on the list: the not-invited page saves the person's place on arrival, with no press ("Save my place" only to
  try again; WP-03 T1) (`waitlist.join`, signed in, not gated by the list): stores the address and the draft's hash, and sets the draft's `held_until` to 90 days. When the person is
  admitted, `/start` claims it as above.

### Data

`idea_drafts` (migration 00xx): id, token_hash (unique), claim_hash (unique, null after use), prompt, interest, card
(jsonb, the validated ConceptCard), weak_line, model_mode, cost_micro, created_at, expires_at (7 days), held_until,
claimed_by, claimed_at, idea_id. `waitlist_entries`: id, account id (unique), email, idea_draft_id, created_at,
admitted_at. Both have RLS on and no policy for `authenticated`: only the api's own connection reads them (tested).
A daily sweep deletes drafts past `greatest(expires_at, held_until)` that nobody claimed.

### Web

- `components/landing/IdeaBox.tsx` (client): the field with the typing placeholder (42 ms a character, 1.8 s hold,
  erased at 16 ms; reduced motion: the first idea, still; stops when the visitor focuses the field), "Shape my idea"
  (dark, white 1 px outline), "Surprise me" opening the interests row, the drafting state (the card filling in), the
  card (design-system `IdeaCard`, `wide`: it fills the hero's column and from 576 px puts the ratings beside the
  pitch), and beside it from an 880 px result (under it before) the design system's `IdeaNextSteps`: "Shape it in the
  Ideation Studio", "Start building it now", what signing in does today, and "Try another idea" behind an inline
  warning that the card on screen will be discarded. The card event carries `redrawsLeft` (the limit store's `peek`,
  recording nothing); at 0 the box says no new ideas are left today instead of offering the button.
- Turnstile's script loads only when the visitor first focuses the field or taps Surprise me.
- The hero works from 390 px: `/` is on the small-screen list as an exact path; the sections below the hero still ask
  for a larger window on a small screen, with the card above them.
- `/new/card/<ideaId>`: the claimed card, "Continue" to the profile questions (or to the next step when the profile
  exists), and the Share slot.

### Sign-in with the typed code

The email carries the link and a six-digit code (Supabase template, DEPLOY). After "Send sign-in link", the page shows
a code field: six digits, `verifyOtp({ email, token, type: "email" })`, then the same `next` as the link.

## Not in this PR

Sharing a card publicly (network session). The 200-a-day sign-up ceiling and opening sign-up (the day spend ceilings
and reporting land). Per-account spend ceilings.
