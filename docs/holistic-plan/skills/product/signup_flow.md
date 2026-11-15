---
key: signup_flow
name: Sign-up flows
description: Designs the form where a person follows, joins, books or buys, so that asking for less gets more people through.
category: product
attribute_name: Sign-up design
attribute_group: craft
when_to_use: Use when asked to design, shorten or review a follow form, account sign-up, booking request or checkout, or when people start one and leave.
roles: product_lead, frontend_engineer
default_for:
stage: building, page_live, first_followers, first_sale
needs: page_publish, repo, analytics
adapted_from: marketing-skills:signup
license_note: MIT, Copyright (c) 2025 Corey Haines
version: 1
---
# Sign-up flows

## When to use this

Use this for the moment a person gives their details to follow a project, join a waitlist, create an account, ask for a booking, or pay. It covers which fields to ask for, their order, the words on the form, what the errors say, and what the person sees right after.

Do not use it for the page around the form or for what happens once the person is in. Those have their own skills.

## Before you start

Read these first:

1. Which kind of flow it is.

   | Flow | What it has to collect | Usual shape |
   | --- | --- | --- |
   | Follow form or waitlist | An email address | One field, one button |
   | Account for a simple app | A way to get back in | A link sent by email, or an account the person already has elsewhere |
   | Booking request for a service | Who they are, how to reach them, what they need and when | Three or four fields |
   | Checkout for a product | Where it ships, and the payment step | Buying as a guest, with an account offered afterwards |

2. What the project does with each piece of data in its first week with that person. A field with no use in that week is a candidate to cut.
3. What the records show: how many people opened the form and how many finished. With fewer than about 100 people opening it, leave the rates aside and fill the form in yourself on a small screen.
4. Anything the law or the payment tool requires, such as an age confirmation or a consent box. Those stay. If you cannot tell whether a field is required, ask the legal lead, or mark it in the hand-back.

## Steps

1. **Sort every field into now, later or never.**

   | Question | If yes, the field goes |
   | --- | --- |
   | Is the project unable to do its part today without it? | Now |
   | Will it be needed only after the person has had their first result? | Later, asked at the moment it is used |
   | Can it be worked out from something already given? | Never: work it out |
   | Is it only nice to know? | Never |

   A typical result: the email address now; a name only if the first message uses it; a phone number only if the project will call or text; a street address at the point of delivery; "How did you hear about us?" as one optional question after the button.
2. **Show something before asking.** Put a sample issue, a price or three photos of finished work above the form, so the person knows what they are joining.
3. **Choose one step or several.** Up to three fields fit one step. More than that, split them: easy questions first, a visible "Step 2 of 3", a way back, and answers that survive a reload. Each step should take seconds.
4. **Get each field right.**

   | Field | Rules |
   | --- | --- |
   | Email address | One field, with no second box to type it again. Check its shape as the person leaves the field and suggest a fix for common slips ("gmial.com"). |
   | Password | Prefer a sign-in link so there is nothing to remember. Where one is needed, state its rules before the person types, add a switch that shows what was typed, and let a password manager fill the field. |
   | Name | One "Name" field. Leave it out unless the next message uses it. |
   | Phone | Only when the project will call or text, and say so next to the field. |
   | A question about them | One at most, optional, after the main fields. |

5. **Write the words.** Each label stays visible above its field. Gray text inside a field is for an example only, because it vanishes when the person types. The button says what happens: "Follow this project", "Request a booking", "Pay $24". Under the button goes one true line that removes a doubt: what they will receive and how often, or "Nothing to pay now" when that is so.
6. **Make errors kind.** Check each field as the person leaves it. Say what is wrong and how to fix it, next to the field. Keep everything they typed. If the person is already signed up, say so and offer the way in.
7. **Design for a small screen first.** One column. Fields and buttons tall enough for a thumb, about 44 pixels. The right keyboard for each field. The browser's autofill left on.
8. **Leave consent to the person.** A box for marketing email starts empty. The terms are linked in plain words next to the button. Never tick a box for someone, and never fold a second purpose into the first.
9. **Write what comes right after.** A confirmation that says it worked, what happens next, and when (only if a record gives the time). If the email address has to be confirmed, say where to look, offer "Send it again", and give a way to correct a mistyped address.
10. **Decide how you will know.** Two counts: people who opened the form and people who finished it. If the form reports where people stopped, note the field. Report counts ("14 opened, 9 finished") together with what you saw when you filled it in yourself.

## What good looks like

A founder walks dogs in one neighborhood and takes requests through a form. Fourteen people opened it last month and three finished.

Before, eleven fields: name, email, phone, street address, the dog's name, breed, age, weight, vet, emergency contact, preferred times.

After, four fields:

- Your name
- Email or phone, whichever you check more often
- Your neighborhood (a short list)
- When do you need walks? (free text, with the example "weekday lunchtimes")

Button: "Request a walk"
Under the button: "Maya replies to set up a free meet-and-greet. Nothing to pay now."
After sending: "Thanks, Sam. Your request reached Maya. She will reply to sam@example.com to arrange a time to meet you and your dog."

Everything about the dog moved to the meet-and-greet, where Maya asks in person. The confirmation gives no reply time because the founder has not set one.

## Output

Hand back:

```
Flow: follow form, account, booking request or checkout
Fields: each one marked now, later or never, with one line of reason
Steps: one, or the split and what is on each
Words: labels, examples inside fields, the button, the line under it, each error message
After sending: the confirmation, and the email-confirmation screen if there is one
Required by law or by the payment tool: what stays, and who confirmed it
How we will know: the two counts, before and after
Assumptions and gaps
```

For a review of an existing form, list each finding as what is wrong, why it loses people and the fix, starting with the one that affects the most people.

## Check before you hand it over

- Every field that remains is used in the first week or is required.
- The email address is typed once, and no rule appears only after an error.
- The button says what happens, and the line under it is true.
- No box starts ticked.
- The form can be completed with one thumb on a small screen.
- An error keeps what was typed and says how to fix it.
- The confirmation says what happens next, with a time only where a record gives one.
- Sensitive details such as a date of birth are asked for only with a stated reason.
- The form is not described as live unless a tool result says so.

## What needs the founder

The founder approves a changed form before it is public. The founder also decides what the form promises (a reply time, a price, the word "free"), the terms, any age limit, what data the project keeps, and how people pay.

## If a tool is missing

If you cannot change the form yourself, hand the field list and the words to whoever can: the engineer, or the founder in the form tool. Without analytics, use the counts in the project's records (followers, requests) and your own walk-through. Say plainly that the new form has not been published.
