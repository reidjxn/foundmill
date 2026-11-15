---
key: experiments
name: Running a fair test
description: Decides whether a change can be tested fairly with the visitors a project has, then sets up the test or says to change it and watch.
category: product
attribute_name: Fair testing
attribute_group: judgement # us-english-allow
when_to_use: Use when someone asks to A/B test, to compare two versions, or whether a change worked, which version won, or whether a result is real.
roles: product_lead, data_engineer, distribution_strategist
default_for:
stage: page_live, first_followers, first_sale, growing
needs: analytics, page_publish
adapted_from: marketing-skills:ab-testing
license_note: MIT, Copyright (c) 2025 Corey Haines
version: 1
---
# Running a fair test

## When to use this

Use this when a change to a page, a form, a message or an offer is on the table and someone wants to know whether it works better. Use it before the change, to decide how to find out, and after it, to read the result.

Most week-one projects do not have enough visitors for a test. The first thing this skill does is say so, and give the founder something more useful to do.

## Before you start

Read from the project's records:

1. The page or step in question, and the action that counts: a follow, a booking request, a sale.
2. How many people reached it in each of the last four weeks, and how many took the action. Counts by week.
3. What else happened in those weeks: a post that went out, a mention somewhere, a price change.
4. Why the change is proposed: what someone saw or heard.

A fair test, often called an A/B test, shows two versions over the same days to visitors split at random, changes one thing, and fixes in advance what is counted and when it ends. Anything less is a before-and-after reading. Both are useful, and each is reported under its own name.

## Steps

1. **Write the reason in one sentence.** "Because [what was seen or heard], we expect [the change] to make more [people] [take the action]. We will know from [the count]." A change with no reason behind it goes back to whoever proposed it.
2. **Work out how many people a test would need.** For each version:

   ```
   people per version = 16 x p x (1 - p) / (d x d)
   ```

   Here p is the rate halfway between today's rate and the hoped-for rate, written as a fraction, and d is the gap between those two rates. The formula gives a test that raises a false alarm one time in twenty and catches a real difference four times in five.

   | Rate today | To see it rise by a fifth | By half | To see it double |
   | --- | --- | --- | --- |
   | 5% | 8,200 | 1,500 | 430 |
   | 10% | 3,800 | 690 | 200 |
   | 20% | 1,700 | 290 | 81 |

   These are people per version. Two versions need twice as many.
3. **Decide between a test and a change you watch.**

   | Visitors expected in the next four weeks | Do this |
   | --- | --- |
   | Fewer than the test needs (under a few hundred, always) | No test. Make the change and watch it (step 4). Say so in the first line of the hand-back. |
   | Enough only to see a doubling | Test only a big difference: another offer, another headline, another first screen. A small wording change will not show. |
   | Enough for the difference you expect | Run a fair test (step 5). |

4. **Change it and watch.** This is the right method for most projects.
   - Make one change. Record the date and exactly what changed.
   - Compare the same number of days before and after, as counts: "9 of 60 before, 14 of 58 after".
   - List everything else that happened in both periods.
   - Get words as well as counts. Read replies and messages, and propose that the founder ask the next five people who take the action what made them do it.
   - Report it as a before-and-after reading. The words "significant", "proven" and "won" stay out of it.
   - If the change is easy to undo and nothing got worse, keep it.
5. **Run a fair test.**
   - Two versions with one difference, large enough to matter.
   - Each visitor is placed at random and sees the same version on every visit.
   - Both versions run over the same days, for at least seven full days, so weekdays and the weekend are both covered.
   - Before it starts, write down the one count that decides it, the people needed per version, the end date, and one thing that must not get worse, such as unsubscribes or refund requests.
   - Check that both versions work and are counted before real visitors see them.
   - Let it run to the planned number. A lead in the first days often disappears, so one version being ahead is no reason to end early. Leave both versions unchanged while it runs.
   - If a version is broken, or the thing that must not get worse does, end the test and report why.
6. **Read the result.**

   | What you see | What to say |
   | --- | --- |
   | The planned number was reached and the gap is at least the one you planned for | Which version did better and by how much, in counts and rates. Recommend it if nothing got worse. |
   | The planned number was reached and the gap is smaller | No clear difference. Keep the simpler version. Do not run it longer in the hope of one. |
   | The planned number was not reached | Unfinished. Give the counts and say the test could not decide. |
   | The new version did worse | Keep the original, and write down what that teaches. |
   | One group of visitors looks different (phones, one source) | A lead for the next test. It is not a finding of this one. |

   If the tool reports a confidence or significance figure, quote it beside the counts. It is not the chance that the version is truly better.
7. **Record it.** The reason, the versions, the dates, the counts, the decision and what was learned go in the project's records, so the same idea is not tried twice. To choose what to try next, rank ideas on three questions: how far it could move the count, how good the evidence for it is, and how easy it is to try.

Nothing untrue is shown to visitors as part of a test, such as a "sold out" label on something that is available. Showing different live prices to different people is the founder's decision.

## What good looks like

A founder writes a weekly newsletter about free things to do with kids in one city. The page gets about 60 visitors a week and 9 of them follow. The founder asks for an A/B test of a new headline.

Reason: "Because three followers wrote that they joined for the weekend list, we expect a headline that names the weekend list to make more visitors follow. We will know from follows per visitor."

Arithmetic: today's rate is 15%. To see it rise by half, to 22.5%, a test needs about 430 people per version, or 860 in all. At 60 a week that is fourteen weeks.

Decision: no test. Change the headline now and watch.

Plan: changed on Nov 16, 2026. Compare the two weeks before with the two weeks after, as counts. The founder posts in a local parents' group every Thursday, which lifts visits in both periods. For the founder's approval: one question in the welcome message to the next five followers, "What made you follow?"

Reading, two weeks later: "18 of 121 before, 27 of 118 after. This is a before-and-after reading, with the Thursday posts in both periods. Four of the five new followers who answered mentioned the weekend list. Keep the new headline."

## Output

Hand back:

```
Decision: fair test, or change and watch, with the arithmetic behind it
Reason: the one sentence
If change and watch:
  the change and its date
  the periods compared, and what else happened in each
  counts before and after
  what people said
If fair test:
  the versions and the one difference
  the count that decides, and the thing that must not get worse
  people per version, start date, earliest end date
  result: counts and rates for each version, and any figure the tool reports
Recommendation, and what to try next
```

## Check before you hand it over

- The first line says whether this was a fair test or a before-and-after reading.
- The arithmetic for the people needed is shown.
- Counts are given, and a group under 100 people is reported as a count ("14 of 58").
- Other things that happened in the period are listed.
- A test ran for at least seven full days and to its planned number, or is reported as unfinished.
- A before-and-after reading is never called significant, proven or a winner.
- A test has one difference.
- Nothing shown to visitors was untrue.

## What needs the founder

A change to what visitors see needs the founder's approval, as any page change does. So does any message that asks people why they acted, and any plan to show different prices to different people. Asking five people in person is work only the founder can do. Draft the question for them.

## If a tool is missing

Without analytics, use the counts in the project's records, such as followers by date, and the visit numbers the page host reports. If visits are unknown, compare the action counts week by week and say that visits are unknown. If nothing can split visitors at random, a fair test is not possible: change it and watch. Showing one version on some days and the other on other days is still a before-and-after reading.
