---
key: churn_prevention
name: Keeping customers
description: Finds why customers leave or stop coming back, and prepares the honest offers, notices and check-ins that keep those who can be kept.
category: customers
attribute_name: Customer retention
attribute_group: judgement # us-english-allow
when_to_use: Use when customers cancel, go quiet, stop reordering or have a payment fail, or when asked to design a cancel step or a failed-payment notice.
roles: chief_of_staff, product_lead, channel_email_automation
default_for: chief_of_staff
stage: first_sale, growing
needs: email_send, payments
adapted_from: marketing-skills:churn-prevention
license_note: MIT, Copyright (c) 2025 Corey Haines
improves: reply_handling, segmentation
version: 1
---
# Keeping customers

## When to use this

Use this once a project has customers and some of them leave: a subscriber cancels, a regular stops booking, a buyer never reorders, or a card payment fails. It covers finding the reason, fitting a response to it, the cancel step, early signs, and failed payments.

Do not use it to answer one customer's message, or to write to people who left long ago. Those have their own skills.

## Before you start

Read these first:

1. The list of customers: who is active, who left or went quiet, and when. Where there is no subscription, "left" means past the usual gap between purchases. Work that gap out from the records.
2. Everything those people said: cancel reasons, messages, conversation notes.
3. What the project can offer: a pause, a smaller option, help, a credit. Only what the founder has approved exists.
4. How canceling works today, step by step.

Two kinds of leaving need different work.

| Kind | Cause | Work |
| --- | --- | --- |
| Chose to leave | A reason of their own | Learn the reason, respond to it, make leaving clean |
| Payment failed | A card that expired or was declined | Notices, and an easy way to update the card |

With fewer than about 20 customers, handle every departure as a conversation. Draft a short personal note from the founder that asks one question, and build no cancel flow until the reasons start to repeat.

## Steps

1. **Collect the reasons in the customers' own words.** One row per person who left: the date, how long they were a customer, what they said, and what they did in their last month. Where someone gave no reason, write "not given".
2. **Group the reasons and count each group.**

   | Reason | What it tells you | Respond with | If that does not fit |
   | --- | --- | --- | --- |
   | Too expensive | The price, or the worth is not clear | A smaller option | A discount for a set time |
   | Not using it | The habit never formed | A pause, or help to get going again | A smaller option |
   | Something is missing | A gap in the offer | A workaround that exists today | Record it for the roadmap. Promise nothing |
   | Went to an alternative | Something else fits better | A question about what it does better | Let them go kindly |
   | It went wrong: late, broken, faulty | Quality | Put it right first | A credit or a replacement, proposed to the founder |
   | Only needed it for a while | A passing need | A pause | A reminder later, if they ask for one |
   | Life changed: moved, closed | Nothing to fix | Thanks, and no offer | |

   The response has to fit the reason. A discount does nothing for someone who is not using the thing.
3. **Write the offer sheet for the founder.** List the responses the project could offer, the size of each (how long a pause, how large a discount and for how many months), the reasons each one is for, and its cost as an Estimate. Keep discounts modest and for a set time, because a deep one teaches people to cancel in order to get it. Keep pauses short, one to three billing periods, with a notice before each one ends. Nothing on the sheet is offered until the founder has approved it. After that, quote only from the sheet.
4. **Design the cancel step.** In this order:
   - Canceling is easy to find and takes no more effort than joining did.
   - One question, "What is the main reason?", with the groups above as choices and a text box. Answering is optional.
   - One response that fits the answer, taken from the approved sheet, with "No thanks, cancel" just as visible beside it.
   - A clear confirmation: what ends and when, what happens to their data or their unused sessions, and how to come back.

   The step carries no guilt, no hidden button and no second or third offer. Where there is no subscription, the same step is one message: the question, then one fitting response.

   As of 2026, the rules on how easy canceling has to be differ by country and by US state. Have the legal lead check the current rule for the places the customers are in.
5. **Watch for early signs.** Keep a short watch list. A customer goes on it when they use or order much less than their own usual, have a complaint that was never answered, looked at the cancel or billing page, or said that something changed. For each, draft one check-in that offers help and asks for nothing. It goes out only with the approval the project's rules require.
6. **Handle failed payments on their own track.** Often the card has expired and the customer wants to stay.
   - Ahead of time: a notice a few weeks before a card on file expires, and a few days before a yearly renewal.
   - Retries, where the charge is tried again, belong to the payment tool. Read what it does and when, and add none of your own.
   - Notices:

     | When | What it says |
     | --- | --- |
     | The day it fails | It did not go through, with the link to update the card |
     | Day 3 | A reminder, with the same link |
     | Day 7 | What will pause, and on which date |
     | Day 10 | The last notice before access or deliveries pause |

   - Each notice is plain text with one link that goes straight to the card update, and a way to reach the project. It blames no one: "the payment did not go through", never "you did not settle your bill".
   - After the last notice the subscription pauses, and coming back takes one step.

   The dates in these notices come from the payment tool's settings, and those settings are the founder's to change.
7. **Count what happened next.** A customer who accepted an offer and left a month later was not kept. For each response, record who took it and whether they were still a customer 30 and 90 days on. Report counts: "3 took a pause, 2 came back".
8. **Pass the reasons on.** A reason given three times or more goes to the product lead as evidence, with the customers' words.

## What good looks like

A founder delivers a weekly box of prepared meals to 14 households in one town. Three canceled last month.

Reasons, in their words: "we're away most of July" (two households) and "it's too much food for just me" (one).

Groups: only needed it for a while, 2. Too expensive, 1.

Offer sheet proposed to the founder: a pause of up to four weeks at no charge, and a half box at $38 beside the full box at $64 (margin Estimate $9 a box, from the cost notes).

Cancel step: the question; then the pause for "away for a while" or the half box for "too much"; then the confirmation: "Your last box arrives on Thursday, Jul 2. Nothing is charged after that. To start again, reply to any of our emails."

Watch list: one household skipped two of the last four weeks. Draft check-in, for approval: "Hi Dana, we noticed you skipped a couple of weeks. If the box isn't fitting your weeks right now, you can pause it or switch to a half box. Just reply to this email."

A month later: "2 households paused and both restarted. 1 moved to the half box and is still a customer after 30 days."

## Output

Hand back:

```
Who left: one row per person, with the date, time as a customer, their words and the reason group
Counts by reason group
Offer sheet for the founder: response, size, which reasons it is for, cost Estimate
Cancel step: the screens or the message, word for word
Watch list: who, which sign, and the draft check-in
Failed payments: what the payment tool does by itself, and the notices word for word
What happened next: who took which response, and whether they stayed 30 and 90 days
For the product lead: reasons seen three times or more, with the customers' words
```

People who exist as records are linked in the mention format you already know.

## Check before you hand it over

- Every reason is in the customer's words or marked "not given".
- Each response fits its reason, and none goes beyond the approved offer sheet.
- Canceling takes no more steps than joining, and the cancel button is as visible as the offer.
- There is no guilt, no made-up deadline and no offer repeated after a no.
- Notices blame no one and carry one link.
- Every message is a draft until it is approved.
- Counts of who stayed are given at 30 and 90 days, or marked "too early".
- Nobody is described as kept, paused or refunded unless a record says so.

## What needs the founder

Every offer that costs money or changes a price: discounts, credits, refunds, free pauses. The settings of the payment tool. Canceling, pausing or changing a customer's subscription. A personal note or a call to a customer who is leaving is the founder's to make. Draft the note. Send the offer sheet as one Needs you decision.

## If a tool is missing

Without access to the payment tool, list what to look for in its settings and mark the retry schedule "not read". Without a tool that sends email, hand back the drafts and say that nothing was sent. Without usage data, build the watch list from orders, bookings and messages in the records.
