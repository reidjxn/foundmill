---
key: tracking_plan
name: Tracking plan
description: Decides which few actions a project counts, names them, and checks that each count is real before anyone relies on it.
category: product
attribute_name: Measurement setup
attribute_group: execution
when_to_use: Use when a project needs to know where followers and customers come from, what to count, how to name events, or whether a number can be trusted.
roles: data_engineer, product_lead
default_for: data_engineer
stage: building, page_live, first_followers, first_sale, growing
needs: analytics, repo
adapted_from: marketing-skills:analytics, marketing-skills:conversion-tracking
license_note: MIT, Copyright (c) 2025 Corey Haines
version: 1
---
# Tracking plan

## When to use this

Use this to decide what a project counts and how: before the page goes live, when a new step is added (a booking form, a checkout), or when a number looks wrong and someone asks whether to believe it.

A tracking plan is a short table of the actions that matter, what each is called, when it counts, and where it is read. For a week-one project it fits on one screen.

## Before you start

Read these first:

1. The decisions the founder faces in the next month, from the roadmap and from what is waiting for them.
2. What the project has: the page, the follow form, any booking or checkout step, and what happens away from the page (a text, a call, a sale at a market).
3. What is already counted and by what: the page host, the form, the payment tool, an analytics tool. Some of these leave no trace on the page, so check before adding anything. Two things counting the same action count it twice.
4. What the project tells visitors about tracking, and whether it shows a consent banner.

## Steps

1. **Start from decisions.** Write up to five questions the founder needs answered this month, each with the decision it feeds. "Which of my three posts brought followers?" decides where to post next. A count that feeds no decision is left out.
2. **Define each action exactly.** An action counts when it is confirmed: the follow is saved, the payment went through, the booking was accepted. A pressed button also counts failed attempts and bots, and a thank-you page counts every reload. For each action, say what makes it final and what happens to the count on a refund or a cancellation.
3. **Name the events.** An event is one recorded action. Name it with the thing first and what happened second, lowercase, with underscores, in the past tense: `follow_submitted`, `booking_requested`, `order_paid`. One name per action, everywhere. Detail goes in properties (`source`, `page`, `amount`, `currency`), never in the name.

   | Project | Events to begin with |
   | --- | --- |
   | A page with a follow form | `page_viewed`, `follow_submitted` |
   | A service | plus `booking_requested`, `booking_confirmed`, `visit_completed`, `invoice_paid` |
   | A product | plus `order_paid`, `order_shipped`, `order_refunded` |
   | A simple app | plus `account_created`, `first_result_reached`, `subscription_started`, `subscription_canceled` |

4. **Keep people out of the data.** No names, email addresses, phone numbers or street addresses in event properties or in links. Use the record's id. Collect only what a question in step 1 needs.
5. **Tag every link the project shares.** Three tags on the end of a link say where a visitor came from: `utm_source` for the place (`instagram`, `school-newsletter`), `utm_medium` for the kind (`social`, `email`, `flyer`), and `utm_campaign` for the push (`launch-week`). Lowercase, hyphens between words, and one spelling per place, kept in one list. A printed flyer gets its own short link. Open each finished link once and check that the tags arrive.
6. **Write down what happens away from the page.** A text asking for a quote, a cash sale, a booking made by phone. For each one, say who records it, where, and under which event name. For a local service these are often most of the picture. One optional question, "How did you hear about us?", at the first contact fills in the rest.
7. **Check that each count is real.** Do each action once yourself, in a preview or a test mode, and confirm three things: the event arrived where it is read, it arrived once, and its properties are right. An event being sent is not proof that it arrived. An action on the live project creates a real record, so label it as a test and keep it out of the counts. For every finding, say how you know it.

   | Label | Meaning |
   | --- | --- |
   | Observed | You saw it yourself this session, in the tool's report, on the page or in the record |
   | Reported | Someone told you, or a document says so |
   | Inferred | You reasoned your way to it. Say from what |

8. **When a number looks wrong, find the cause before changing anything.** Name the cause and the smallest change that fixes it, and stop there. "Cause not found" is a valid finding: list what you ruled out and the one check that would settle it. A guess is never presented as the cause.
9. **Set the rules for reading.**
   - Counts come first. A rate needs at least 30 in its bottom number. Below that, write "9 of 41".
   - The top and the bottom of a rate cover the same days.
   - People still inside their window, such as a trial that has not ended, are pending. Leave them out of the rate and say how many there are.
   - Totals are computed from the rows and then checked a second way.
   - With fewer than about 50 followers or customers, the list of people (who, when, from where) tells more than a chart.
10. **Respect the visitor's choice.** Where the law requires consent before tracking, nothing is recorded until the visitor agrees, and a visitor who declines is left untracked. Which law applies is a question for the legal lead or the founder. As of 2026, several regions require consent before analytics cookies are set. Check the current rule for the places the project's visitors are in.

## What good looks like

A founder mows lawns in one town. The page has a quote form, but most requests arrive by text after someone sees a flyer.

Questions: Which of the three flyer spots brings requests? How many quotes turn into booked jobs?

| Event | Counts when | Properties | Recorded by |
| --- | --- | --- | --- |
| `page_viewed` | The page loads | `source` | The page host |
| `quote_requested` | The form is saved, or a text arrives asking for a quote | `source`, `channel` | The form, or the Chief of Staff from the founder's note |
| `quote_sent` | The founder gives a price | `amount` | The Chief of Staff from the founder's note |
| `job_booked` | The customer agrees a date | `amount` | The Chief of Staff from the founder's note |
| `job_paid` | The money is received | `amount` | The payment tool, or the founder's note for cash |

Links: each flyer spot has its own short link, tagged `utm_medium=flyer` with `utm_source=library-board`, `utm_source=hardware-store` or `utm_source=cafe`. The form and the founder's first reply both ask "How did you hear about us?"

Check: one test request through the form in preview arrived once in the records with `source=library-board` (observed). Texts were not checked, because they depend on the founder's note.

Reading: "This month: 7 quote requests (4 by text), 5 quotes sent, 3 jobs booked. Library board 4, hardware store 2, not known 1."

## Output

Hand back:

```
Questions: up to five, each with the decision it feeds
Events: name, counts when, properties, recorded by, read where
Links: the allowed sources, mediums and campaigns, and each tagged link
Away from the page: who records each moment, and where
Checks: each event marked observed, reported or inferred, with what was done and the date
Not verified: what could not be checked, and the one step that would check it
Reading rules for this project
Privacy: what is collected, what is left out, the consent status and who confirmed it
```

## Check before you hand it over

- Every event feeds a question on the list.
- Each event has a moment when it is final, and that moment is a confirmation.
- The names follow one pattern, and no two names mean the same action.
- No personal data sits in a property or a link.
- Each event was seen to arrive once, or is listed under "Not verified".
- Test records are labeled and kept out of the counts.
- Every finding is marked observed, reported or inferred.
- Each rate has 30 or more in its bottom number and covers matching days.

## What needs the founder

Connecting or paying for an analytics tool: the free route below comes first, and a paid one is proposed with its cost as an Estimate. What the project tells visitors about tracking, and whether it shows a consent banner. Any test on the live project that would reach a real customer or a real payment. The founder also records the moments that happen away from the page, so keep that to one line per event.

## If a tool is missing

Without an analytics tool the plan still works with the page host's visit count, the follow list and the project's records. Say which questions cannot be answered yet. If you cannot change the page or the code, hand the event table to the engineer. Anything you could not see arrive goes under "Not verified".
