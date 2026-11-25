---
date: 2026-11-24
branch: claude/beautiful-turing-ke5wjw
title: A price, one pay or booking button and "Ask a question" on the public page (WP-08 T6)
areas: [shared, api, db, dugout, modules, web, agents, docs]
supersedes: []
---
## What changed
A project's public page can now say what you get, show a price, carry one button to a place that takes payment or a
booking, and offer "Ask a question". The four fields live in the page's existing jsonb (`offer`, `price`, `cta` with a
label and a link, `askForm`), so there is no migration; a page that sets none of them reads and stores exactly as before
(empty fields are left out). The button's link must be https on a listed host (`PAGE_CTA_HOSTS`: Stripe's payment pages,
Gumroad, Ko-fi, Buy Me a Coffee, PayPal.Me, Cal.com, Calendly, Tally; an exact host or a dot-suffix, so
`buy.stripe.com.evil.example` is nobody's). It is checked when the founder types it (the field says "That link is not
from a payment or booking site we can show yet." and Publish waits), when the page is saved or published, and again every
time a visitor reads the page, so a link written around the api never reaches anyone. The button is an `<a>` with
`rel="nofollow noopener noreferrer"` that opens in a new tab. "Ask a question" is a mail link to the project's own Foundmill
address (`mailto:`, subject "Question about ‹name›"), drawn only while the page offers it, platform mail is live and the
address is active; there is no web form and no new public write. A reply to that mail is read by WP-08 T2. The text of
the offer, the price and the button's label is screened with the rest of the page (an address, a phone number or markup
holds the publish). A visitor who arrived through a shared post and opens a Stripe payment link gets
`client_reference_id=s.<code>` added, for the credit to the post once WP-07's payment webhook reads it.

## Decisions
### Agents do not write the price or the button
The Product lead's page draft keeps its four fields; `finaliseProjectPage` never carries a price, offer, button or ask
switch whatever the model sends (a test says so). The founder fills them in.

### "Ask a question" is off until the founder turns it on
The plan makes it on for new drafts. New pages keep the starter draft exactly as it was; the switch is one press in the
console, and turning it on and publishing creates the project's mail address if it has none. Old stored copies read as off.

### The preview shows the ask link with a placeholder address
The console preview draws the link when the switch is on, with `preview@example.com`, so the founder sees where it goes.

## Not done
- The payment webhook's reading of `client_reference_id` (`paymentPostCode` in ingest): it waits for WP-07's Stripe webhook; the seam on the page is in place.
- Markup for search engines and the Markdown file for AI readers do not mention the offer, price or button yet (T7 added neither an `Offer`).
- The pay link stays a pasted link: WP-07 T8 makes one through the gateway, mock-first, and its host is already on the list.
