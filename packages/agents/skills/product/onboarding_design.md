---
key: onboarding_design
name: First-use experience
description: Designs what a new person meets between saying yes and first getting what they came for, so fewer of them stall on the way.
category: product
attribute_name: First-use design
attribute_group: craft
when_to_use: Use when people follow, sign up, book or buy and then stall, or when asked to design or review what a new person sees first.
roles: product_lead, frontend_engineer
default_for: product_lead
stage: building, page_live, first_followers, first_sale
needs: analytics, email_send
adapted_from: marketing-skills:onboarding
license_note: MIT, Copyright (c) 2025 Corey Haines
improves: spec_writing
version: 1
---
# First-use experience

## When to use this

Use this when you design or review the stretch between a person saying yes (they follow the project, create an account, book, or buy) and the first time they get what they came for. It covers the first screen, the confirmation message, empty screens, a setup checklist, the wait before a service or a delivery, and the nudge to someone who stalled.

Do not use it for the sign-up form itself or for the wording of a full email sequence. Those have their own skills.

## Before you start

Read these first:

1. The positioning notes: who the project is for and what they came to get.
2. What happens today after a person says yes. Walk through it yourself in a preview if you can. Otherwise read the specification and the messages the project sends.
3. The records of real people: who said yes, and how far each one got.
4. What is built today. Design only with what exists or is already planned.

Then write the first result in one sentence. The first result is the first moment the person gets what they came for, stated so that anyone could check whether it happened.

| Project | First result |
| --- | --- |
| A simple app | The person has done the main thing once, with their own data |
| A service | The first session is booked with a date and time, then delivered |
| A handmade product | The order arrives and gets used |
| A newsletter | The first issue is opened and read |
| A page with only a follow form | The follower gets a first message worth reading, with one thing they can do |

If the records do not show what people came for, state the first result you assumed in the hand-back and continue.

## Steps

1. **List every step between yes and the first result.** Screens, fields, choices, emails, confirmations, permissions and waits. Number them and count them.
2. **Put each step through four questions, in this order.**

   | Question | If the answer is yes |
   | --- | --- |
   | Can the person reach the first result without it? | Cut it, or move it to after the first result |
   | Do the records already hold the answer? | Fill it in for them |
   | Do most people choose the same way? | Make that the default and let them change it later |
   | Is it needed, and hard? | Keep it, place it as late as it can go, and say why you ask |

3. **Rebuild the path in the order that reaches the first result soonest.** The first visit has one aim. A profile, settings, inviting others and extra features all wait until after it.
4. **Choose how the first visit opens.**

   | Opening | Use it when | Watch for |
   | --- | --- | --- |
   | Straight in | The first action is obvious | A blank screen with no next step |
   | Two or three setup questions | The answers change what the person sees | A question that changes nothing: cut it |
   | A filled example | The thing looks empty until it holds data | The example has to be labeled as an example |

5. **Give every screen and every message one next action.** Let the person do the thing. A tour of features can wait, and no screen ends without a way forward.
6. **Write the empty screens.** An empty screen says what the area is for, shows what it looks like with something in it, and has one button that adds the first item.
7. **Add a checklist only when setup has three or more steps.** Three to five items, with the one closest to the first result at the top. Tick what the person has already done (creating the account counts), so the list opens in progress. Give it a way to be closed.
8. **Design the wait.** A service or a physical product has a gap between paying and getting. The confirmation says what happens next, when, and what the person can do in the meantime. Use only dates and times the founder has confirmed.
9. **Plan one nudge for people who stall.** A step happens when the person wants the result, finds the step easy, and is prompted at that moment. When someone stops, work out which of the three is missing before you write anything. Then draft one short message that names the single next step. It goes out only with the approval the project's rules require.
10. **Decide how you will know it worked.** With fewer than about 30 new people, keep a list: each person, the last step they reached, the date. Read the list and report counts ("6 of 11 reached the first result"). With more people, report the share who reach the first result and the typical time it takes them. Any target you set is labeled Estimate.

## What good looks like

A founder built a small app that splits chores among housemates. Eleven people created an account last week, and four of them got as far as a week of chores.

First result: "The house sees this week's chores with a name on each."

Before, nine steps: choose a password, give an email address, confirm it, your name, a photo, name the house, invite housemates, type each chore, set the schedule.

After, four steps: email, name the house, pick chores from a list of eight common ones (five already ticked), see the week with your name on every chore. The next screen says: "Invite a housemate to take some of these."

Empty week screen: "No chores yet. Pick the ones your house does and this page becomes the week's plan." Button: "Pick chores".

Moved later: the photo, the schedule (weekly by default), and confirming the email, which is asked before the first invitation goes out.

How we will know: the list of new people with the last step each reached, compared with 4 of 11 last week.

A service works the same way. For a tutor, the first result is a first lesson with a date. The confirmation after booking gives the date, the place, what to bring, and how to change the time.

## Output

Hand back:

```
First result: one sentence that anyone could check
Today: the numbered steps between yes and the first result, and the count
Changes: each step marked cut, later, filled in, default or keep, with one line of reason
New path: the steps in order
Words: first screen, confirmation, each empty screen, checklist items, the nudge
The wait (services and products): what the person is told, and the record behind each date
How we will know: the list or the measure, with any target labeled Estimate
Assumptions and gaps: what the records did not show
```

People who exist as records are linked in the mention format you already know.

## Check before you hand it over

- The first result is one sentence that anyone could check.
- Every step that remains is needed to reach it. The rest is cut, defaulted, filled in or moved later.
- Each screen and message has one next action, and none is a dead end.
- Nothing describes a feature that is not built.
- Any example data is labeled as an example.
- Every date, delivery time and price comes from a record.
- A checklist has three to five items, ticks only what was really done, and can be closed.
- No message is described as sent unless a tool result says so.

## What needs the founder

The founder approves any message that goes to people, and any change to what the project promises: a date, a delivery time, what is included. A personal welcome, such as a call or a note from the founder, is the founder's to offer. Draft it as an option and leave the scheduling to them.

## If a tool is missing

Without analytics, build the list in step 10 from the project's records: who said yes, and what each did next. If you cannot change the product yourself, hand the new path and the words to the engineer as a specification. If you cannot send messages, hand back the drafts and say plainly that nothing was sent.
