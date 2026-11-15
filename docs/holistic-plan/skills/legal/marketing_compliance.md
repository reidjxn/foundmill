---
key: marketing_compliance
name: Rules for marketing messages
description: Checks a marketing email, text, post, ad or endorsement for consent, sender identity, unsubscribe, disclosure and supportable claims before it goes out.
category: legal
attribute_name: Marketing rules
# us-english-allow: attribute_group is an enum key, spelled this way in the product's code
attribute_group: judgement # us-english-allow
when_to_use: Use when a marketing email, text, post, ad or paid endorsement is about to go out, or when a contact list is being built.
roles: legal_lead, moderation, channel_email_automation, channel_lead_generation
default_for:
stage: page_live, first_followers, first_sale, growing
needs: web_research
adapted_from: original
license_note: original
version: 1
---
# Rules for marketing messages

## When to use this

Use this before any message that promotes the project leaves it: an email to a list, a text, a social post, an ad, a message to a stranger, a post by someone who was paid or given something. Use it when a contact list is being put together too, because most problems start with where an address came from.

The check returns pass, fix or stop. It is information, not legal advice, and it never stands in for the founder's approval of the send.

## Before you start

Have these in front of you:

1. The message exactly as it will go out, with its subject line, sender name, footer and links.
2. The recipients, with where each address came from and when: a form on the page, a purchase, a reply.
3. The suppression list: everyone who unsubscribed, replied "stop" in any words, or must not be contacted.
4. Where the recipients are. If the records do not say, apply the strictest column of the table that could apply.
5. The record behind every claim in the message.
6. Whether anyone who appears in it or posts it was paid, was given something free, or is close to the founder.

## Steps

1. **Decide whether it is marketing.** A message that promotes the project is marketing. A receipt, a booking confirmation or an answer to a question the person asked is not, as long as it carries no promotion. A message that mixes the two is marketing.
2. **Check consent and suppression for every recipient.**
   - Each address has a recorded source that fits the table for that person's region.
   - The list is compared with the suppression list on the day of the send. A person on it receives nothing, and that includes a "we miss you" note.
   - Bought, rented, guessed and scraped addresses are never used.
   - Never cold email a consumer in the EU or UK.
3. **Check who it says it is from.** The sender name is the project's name or the founder's real name. The subject line matches the content. Someone reads the reply address. Never present an agent as a person. Where the law or the platform requires it, the message says it was written with AI.
4. **Check the way out.** Every marketing email has an unsubscribe link that works in one step. Every marketing text says how to stop ("Reply STOP"). A request is acted on the same day, even where the law allows longer.
5. **Check the footer.** Marketing email to US recipients shows a valid postal address: a street address, a post office box or a registered private mailbox.
6. **Check texts on their own.** A marketing text needs the person's prior written agreement to get marketing texts from this sender. Agreement to email does not cover texts. In the US, texts go out only between 8 AM and 9 PM in the recipient's time zone.
7. **Check endorsements.** If the person posting was paid, was given something free, or is a relative or part of the project, the post says so clearly near the start, in words a reader understands: "ad", "paid partnership", "I got this free". A platform's built-in label helps, and the words still go in the post. Reviews come from real customers and are never paid for on condition that they are positive.
8. **Check every claim.** Each factual claim points to a record that existed before the message was drafted. "Best", "fastest" and "guaranteed" need proof or come out. A comparison names what it compares and when. A price shows the full amount and any condition. "Free" means free. A deadline or a limited number appears only when it is real. A claim about health, earnings or safety stops the message, which goes to the founder with a recommendation to get a lawyer.
9. **Give the verdict.** Pass: every check holds. Fix: name each line to change and the change. Stop: a check fails in a way no edit can repair, such as a list with no recorded source. A stop goes to your lead at once.

The rules by channel and region, as of 2026. Check the current rule at an official source before relying on a cell, and record the source and the date.

| Channel | United States | European Union | United Kingdom |
| --- | --- | --- | --- |
| Marketing email to a consumer | Allowed until the person opts out. Needs a true sender and subject, a postal address, and an unsubscribe acted on within 10 business days | Needs the person's consent first. Existing customers may hear about similar things if they could opt out when they gave the address and can in each message | Same as the EU |
| Marketing email to a business address | Same as to a consumer | Differs by country, and several require consent. A named person's address is personal data, so say who you are and let them object | A company's address may be emailed with the sender named and an opt-out offered. Sole traders count as individuals |
| Marketing text | Prior written consent, a stop word, 8 AM to 9 PM | Consent first, as for email | Consent first, as for email |
| Paid or gifted endorsement | Clear disclosure in the post itself. Fake or bought reviews are banned | Must be recognizable as advertising. Fake reviews are banned | Labeled as an ad. Fake reviews are banned |
| Claims | Truthful, with the evidence in hand before publishing | Must not mislead | Evidence held before publishing |
| Written or made with AI | No general federal rule. Some states, California among them, require a bot used to sell to people online to say it is a bot. Platforms require labels on realistic AI-made media | Transparency duties under the AI Act began to apply in Aug 2026, and some dates have moved: people are told when they are dealing with an AI system, and realistic synthetic media is labeled. Check which duties are in force | No general rule. A message must not mislead about who or what is behind it |

Canada requires consent, a named sender and an unsubscribe for both email and texts. For any other country, check before the send.

## What good looks like

An email is staged for 46 addresses. Subject: "Our best-ever candles, 50% off today only." Sender name: "Sam from Wick and Co". The footer has an unsubscribe link and no postal address. Of the addresses, 31 came from the page's form, 12 from a sign-up sheet at a market headed "newsletter", and 3 were copied from a shop directory in France.

```
This is information, not legal advice.
Verdict: fix, with a stop for 3 addresses.
Recipients: 46 checked. 3 taken out: copied from a directory, no recorded consent, in the EU. 2 taken out: on the suppression list. 41 remain.
Sender: nobody named Sam is on the project. Change to "Wick and Co" or the founder's name.
Unsubscribe: present, works in one step. Pass.
Footer: 9 recipients are in the US, so a postal address is required. Needs the founder.
Claims: "best-ever" has no record: cut. "50% off": matches the price record. "today only": the offer record has no end date: cut, or the founder sets a real one.
AI: a one-way email the founder has read. No disclosure rule in the table applies.
Sources: official US and EU guidance on commercial email, checked Nov 15, 2026.
```

## Output

```
This is information, not legal advice.
Message: <which message, which channel>
Verdict: pass, fix or stop
Recipients: <how many checked; how many taken out and why; regions>
Findings: <each check: pass, or the line to change and the change>
Claims: <each claim: its record, or "no record" and what to do>
Disclosures: <endorsement and AI, where required>
Needs the founder: <for example the postal address>
Sources: <rule, official source, date checked; or "not verified">
```

## Check before you hand it over

- Every recipient has a recorded source, and the list was compared with the suppression list today.
- Nothing in the list was bought, rented, guessed or scraped.
- No consumer in the EU or UK is getting a cold message.
- Marketing email has a true sender, a matching subject, a one-step unsubscribe and, for US recipients, a postal address.
- Texts have recorded written agreement, a stop word, and a send time inside the allowed hours.
- A paid or gifted post says so in the post.
- Every claim has a record, and every deadline or limit in the message is real.
- An agent is never presented as a person, and the AI disclosure is there where it is required.
- The hand-back opens with the information line and states one verdict.

## What needs the founder

Approving the send. Choosing the postal address. Deciding to write to a new kind of audience. Any claim about health, earnings or safety. Any arrangement with someone who will be paid or given something to post.

## If a tool is missing

If you cannot read the suppression list, the verdict is stop until you can. If you cannot tell where recipients are, apply the strictest column. If you cannot find the record behind a claim, mark it "no record" and recommend cutting it. If you cannot check a current rule, mark it "not verified" and say what to check.
