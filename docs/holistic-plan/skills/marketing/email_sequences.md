---
key: email_sequences
name: Email sequences
description: Writes the welcome message and a short run of emails for people who followed a project, and decides when the emails stop.
category: marketing
attribute_name: Email sequences
attribute_group: craft
when_to_use: Use when a project has followers and needs a welcome message, a short series of emails to them, or a decision on whether to keep emailing.
roles: channel_email_automation
default_for: channel_email_automation
stage: page_live, first_followers, first_sale
needs: email_send
adapted_from: marketing-skills:emails
license_note: MIT, Copyright (c) 2025 Corey Haines
version: 1
---
# Email sequences

## When to use this

Use this for email to people who asked to hear from the project: followers who joined through the follow form on the project page, and later the first customers. It covers the welcome message, a short sequence (a few emails sent in a set order over a couple of weeks) and the point where the emails stop.

Do not use it for people who never asked to hear from the project. That is cold email, which has its own skill and stricter rules.

## Before you start

Read the records first:

1. **Who is on the list and how they got there.** A follower gave an address on the project page and agreed to updates about this project. That consent covers this project's updates and nothing wider.
2. **What the page promised.** Read the words beside the follow form. If they say "one email when we open", the sequence is one email when the project opens.
3. **What is real today.** What exists, what comes next, and any date or price the founder has confirmed. Note the record behind each fact.
4. **The one step the sequence leads to.** Reply with an answer, join the first batch, book, or buy. A week-one project often has nothing to sell yet, and then the step is a reply.
5. **The sending limits.** The project's sending address sends one message to one person at a time, inside a daily cap. Read the cap and plan the schedule inside it.
6. **What else these people receive.** Nobody gets two emails from the project in one day.

Then pick the sequence that fits:

| Who | Sequence | Length |
| --- | --- | --- |
| New follower, nothing to buy yet | Welcome, something useful, the story | 3 emails over about 10 days |
| New follower, something to buy or book | Welcome, something useful, the story, the offer | 4 emails over about 2 weeks |
| New customer | Thank you and what happens next, how to get the most from it, a check-in | 3 emails over about 2 weeks |
| Follower who has gone quiet | A check-in, then one "stay or go" email | 2 emails, a week apart |

## Steps

1. **Write the plan before any email.** One line each: who gets it, what starts it, the one step it leads to, how many emails, and what takes a person out of it. If you cannot name the step, the project is not ready for a sequence, and the welcome message goes alone.
2. **Send the welcome message the day they follow,** while they still remember why. In under 125 words it does five things:
   - thanks them in one line
   - says what the project is in one sentence, in the founder's words
   - says what they will receive and how often
   - gives one small real thing now: where the project stands, or the answer to the question people ask most
   - asks one question they can answer by replying

   Replies are the best thing a week-one project can get from email. They show what people want, in their own words.
3. **Give every later email one job.**

   | Email | When | Job | For a week-one project |
   | --- | --- | --- | --- |
   | Something useful | Day 2 to 3 | A small win on the problem the project is about | One tip the founder uses themselves |
   | The story | Day 5 to 7 | Why this person is building this | One true paragraph, in their voice |
   | The offer | Day 10 to 14 | The one step, asked plainly | What it is, what it costs, how to say yes |

   One ask per email. An email that asks for a reply and a purchase tends to get neither.
4. **Make the subject line clear before clever.** Aim for 40 to 60 characters, and make it hold up if it is the only line they read. Shapes that work: a question in the reader's words, "How to {result}", "{First name}, your {thing} is ready" when it is. Preview text (the gray line a mail app shows after the subject) continues the thought and never repeats it.
5. **Write the body as one person writing to another.** Open with the reason you are writing. Then why it matters to them, the useful part, the one ask, and a sign-off with the project's name. Short paragraphs, plain text, one link. Length follows the job: 50 to 125 words for a notice, 150 to 300 for something useful, up to 500 for a story.
6. **Personalize from records only.** Use the first name if it is on record, and write the greeting so it reads fine without one. Mention something they did only if a record shows it.
7. **Space the emails.** Two to three days apart at first, then four to seven. Send in the reader's daytime when the record shows where they are.
8. **Decide what takes a person out.**
   - They took the step. The sequence ends for them.
   - They replied. The sequence pauses for them, and you draft an answer for approval.
   - They unsubscribed, or the address bounced. They go on the suppression list (the addresses the project never writes to again). The send tool will refuse them, and that refusal is final.
   - The sequence ended. From then on they hear from the project only when something real happens: an opening date, a new batch, a milestone.
9. **Know when to stop.** A follower who has not clicked or replied in about 60 days gets a check-in, then one honest email: "Do you still want these?" with a one-tap way to stay. If no answer comes, stop writing to them. A small list that reads is worth more than a large one that does not. If unsubscribes or spam complaints jump after one email, pause the sequence, tell the founder, and rework that email before anything else goes out.
10. **Count what a small list can show.** Replies, and the step taken. Many mail apps open messages automatically (as of 2026), so opens overstate interest. Under 100 sends, report counts ("7 of 40 replied") and label any rate an Estimate.
11. **Take out the tells of machine-written email.** "I hope this finds you well", "Just checking in" and "Great news" as openers. A fake "Re:" or "Fwd:" in a subject. "It's not X, it's Y". A question you answer yourself. A closing offer to answer any questions: ask for one specific thing, or end.

## What good looks like

Mara bakes sourdough in Tucson and takes orders for Saturday pickup. Thirty-one people followed her page, which promised "one email a week with that week's loaves". The welcome message:

Subject: You're on the list for Saturday sourdough
Preview: First bake is Nov 21. One question for you.

"Hi Jo,

Thanks for following Mara's Saturday Sourdough. Mara bakes 24 loaves each Saturday, and you order ahead and pick up from her porch on 4th Avenue.

The first bake is Saturday, Nov 21. You will get one email each Wednesday with that week's loaves, and nothing else.

One question: plain, seeded or rye? Reply and tell us which you would order.

Mara's Saturday Sourdough
[one-tap unsubscribe] [the project's postal address]"

It keeps the page's promise, every fact came from Mara, and the only ask is a reply she can use to plan the bake.

## Output

Hand back:

```
Sequence: <name>
Who gets it: <the group, how they joined, the consent record>
Starts when: <what starts it>
Leads to: <the one step>
Ends for a person when: <the exits from step 8>
Send plan: <emails per day, inside the cap>

Email 1: <its job>
  Send: <timing>
  Subject:
  Preview:
  Body:
  Ask: <the one thing, and where the link goes>
Email 2: ...

Gaps: each [NEED: ...] with what would fill it
Sources: the record behind each factual claim
Status: drafted, waiting for approval, or sent (with the tool result)
```

People and organizations that exist as records are linked in the format you already use.

## Check before you hand it over

- Everyone on the list followed the project, and the suppression and consent checks ran before the send.
- The sequence sends nothing the page did not promise.
- Each email has one job and one ask.
- Every fact has a record behind it. Customers, figures, dates and discounts all come from the records.
- Every email carries a working one-tap unsubscribe, the project's name and a postal address.
- The schedule fits inside the daily cap, and nobody gets two emails in a day.
- None of the tells in step 11 remain. Search for them.
- Nothing is described as sent unless a tool result says so.

## What needs the founder

The founder approves the sequence before the first email goes out, because it is contact with people outside the project. They also approve any promise in it (a price, a date, a discount), anything written in their own name, and every reply to a person. After a pause for complaints, the founder decides whether sending starts again. Prepare each approval so it takes one read: the full text, who receives it, and when.

## If a tool is missing

If you have no tool that sends email, or the project's sending address is not switched on, hand the sequence back in the output format as a founder task, with the order and timing, and say plainly that nothing was sent.

If the send tool refuses a message (the cap is reached, the person unsubscribed, sending is off), nothing was sent. Report the refusal as it is, and never try another route. Messages held back by the cap go out on the next day's allowance.

A simulated result is not a send. Say it was simulated.
