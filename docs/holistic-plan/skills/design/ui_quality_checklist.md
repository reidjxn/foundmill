---
key: ui_quality_checklist
name: Interface quality checklist
description: Checks a page or screen against a fixed list covering access, touch, layout, type, states, motion and forms, and reports each miss with a fix.
category: design
attribute_name: Interface quality
attribute_group: craft
when_to_use: Use when a page or screen is about to be handed over or reviewed, or when someone says an interface looks unfinished or is hard to use.
roles: qa_engineer, review_agent, frontend_engineer, design_to_code
default_for: qa_engineer
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: ui-ux-pro-max:ui-ux-pro-max
license_note: MIT, Copyright (c) 2024 Next Level Builder
version: 1
---
# Interface quality checklist

## When to use this

Use this on any customer-facing page or screen of a founder's project, on any stack, at three moments: before you hand over a screen you built, when you review a screen someone else built, and when a founder or customer says something looks unfinished or is hard to use.

It is a list to run from top to bottom. The order is the priority: a page that fails section 1 or 2 shuts some people out entirely, so those come before anything about polish. It does not choose a look for the page. It checks that whatever look was chosen can be read, reached and used.

## Before you start

- Know what you can see. You may have the markup and styles, screenshots taken at desktop width and at 390 px wide, and the results of browser tests. Say in your report which of these you used.
- Know the project's own system: its components, tokens and brand colors. A miss is fixed with those. Never fix one by bringing in another product's look.
- List the views in scope and, for each, its states: loading, empty, error, success, and signed out where that applies.
- Measure where a number exists. Work out contrast from the two color values, and read sizes from the styles. Where you cannot measure, write "not measured". Do not pass an item on impression.

## Steps

Run each section for each view. Mark every item pass, miss or not checked.

**1. Can everyone read and reach it (blocker when missed)**

- Text contrast is at least 4.5 to 1 against its background, or 3 to 1 for large text (24 px, or 19 px bold). Check quiet text, placeholder text and text on colored buttons, which fail most often. Measure a dark theme separately.
- Icons that carry meaning and the borders of inputs reach 3 to 1.
- Every control can be reached and used with the keyboard alone, in an order that follows the page.
- Focus is always visible, and a sticky header or banner never covers the focused control.
- Every form field has a visible label. Placeholder text is not a label.
- Images that carry meaning have alt text. Icon-only buttons have an accessible name.
- Headings go in order, with one main heading per page.
- Color is never the only signal. An error has words, and a status has a label or an icon.
- Zoom is not disabled, and the page still works with text enlarged to 200 percent.

**2. Touch and feedback (blocker when missed)**

- Touch targets are at least 44 by 44 px on touch screens, with at least 8 px between neighbors.
- Nothing depends on hover alone. Whatever hover reveals can also be reached by tap and by keyboard.
- Every action answers within a moment: a pressed state, then a loading state for anything slower.
- A button that submits is disabled while the request runs, so a double tap cannot send twice.
- Anything that cannot be undone asks for confirmation first, or offers an undo.

**3. Layout at every width**

- At 390 px wide nothing scrolls sideways, nothing overlaps and nothing is cut off. Check 320 px if you can.
- At desktop width the content keeps a readable maximum width and does not stretch from edge to edge.
- Left and right page edges are equal, and blocks align to the same edges from section to section.
- All spacing comes from one scale. Related items sit closer together than unrelated ones.
- A fixed header or bottom bar never hides content or the last item of a list.
- Images and embeds have a set size or ratio, so the page does not jump while they load.

**4. Type and color**

- Body text is 16 px or larger. Nothing is smaller than 12 px.
- Line height is about 1.5 for paragraphs. Reading lines run 45 to 75 characters.
- There are six text sizes at most and two families at most. Weight, not color alone, marks the hierarchy.
- There is one color for actions. Colors come from the project's tokens, with no one-off values in components.
- Long words, web addresses and email addresses wrap and never push the page wider.

**5. States**

- Loading: a view that waits on data shows that it is loading and keeps its layout stable.
- Empty: it says what will appear there and offers the one action that fills it.
- Error: it says what went wrong in plain words and how to try again. It does not show a raw code or a blank screen.
- Success: a completed action is confirmed where the person is looking.
- A disabled control says why it is disabled, or is not shown.

**6. Forms**

- Each error appears beside its field and says the cause and the fix. After a failed submit, focus moves to the first problem.
- A field is checked when the person leaves it, not on every keystroke.
- Required fields are marked. Input types match the data (email, tel, number), so phones show the right keyboard.
- Autofill works, a password manager can fill the sign-in form, and what the person typed survives an error.
- A flow with several steps shows where the person is and lets them go back.

**7. Motion**

- With reduced motion switched on, animations stop or shrink to a fade, and no content stays hidden waiting for one.
- Motion explains a change the person caused. Nothing moves only for decoration.
- Anything that moves by itself for more than 5 seconds can be paused, and no animation blocks input or shifts the layout.

**8. Consistency and finish**

- One primary action per view. Secondary actions look secondary.
- One icon set at one size. No emoji used as icons.
- The same thing looks the same everywhere: buttons, inputs, cards, corner radius, shadow.
- There is no placeholder text, sample name, invented review or logo of a company that is not a customer.
- Every link goes somewhere, Back does what a person expects, and the page has a title, a description and a language set.

**9. Signs of a machine-made default (flag, do not block)**

A purple gradient or gradient text. Every section built from identical rounded cards. A small all-caps label above every heading. Every block fading in on scroll. Three feature cards with an icon each. A row of large statistics with no source. One of these alone is a style choice. Several together mean nobody made a choice, so flag them for whoever designs the page.

Then grade each miss:

| Severity | Means | Examples |
| --- | --- | --- |
| Blocker | Someone cannot read it or use it | Unreadable text, a control the keyboard cannot reach, sideways scroll on a phone, a form with no error shown |
| Should fix | It works, but it costs trust or effort | No empty state, layout jumps on load, mixed button styles |
| Polish | Finish | Uneven spacing, mixed icon sizes |

Every miss gets the view, the width, the element (its text or position), the measured value and one concrete fix: a size, a color pair, a spacing value, a wording. "Improve the contrast" is not a fix.

## What good looks like

```
View: / (waitlist page). Checked from the styles and from screenshots at
  1440 px and 390 px, run on 5c1e77a. Not checked: screen reader, dark theme.

Blocker     390 px   Helper text under the email field
  #9CA3AF on #FFFFFF is 2.5 to 1. Fix: #6B7280, which is 4.8 to 1.
Blocker     both     Email field
  Has placeholder "you@example.com" and no label. Fix: a visible label
  "Email" above the field.
Blocker     390 px   "Join" button
  36 px tall. Fix: min-height 44 px.
Should fix  both     After submit
  The page reloads with no message. Fix: show "You are on the list" in
  place of the form.
Flag        both     Section 9
  Gradient headline, three icon cards and fade-in on every block.

Passed: keyboard order, focus ring, heading order, no sideways scroll at 390 px.
```

## Output

```
View and how it was checked (styles, screenshots at which widths, browser tests, which run)
Not checked: items or states you could not check, and why
Misses: severity, width, element, measured value, fix
Flags: section 9 items
Passed: the sections that passed, in one line
```

A reviewer adds the verdict: any Blocker means request changes.

## Check before you hand it over

- Every view in scope was run through all nine sections, at 390 px wide and at desktop width.
- Every number in the report was measured from the styles or a screenshot.
- Every miss has an element, a value and a concrete fix that uses the project's own tokens.
- Items you could not check are listed as not checked, never as passed.
- Each view's loading, empty and error states were looked at.
- Severities follow the table. A spacing point is not a Blocker.
- The report gives no overall score and no praise.

## What needs the founder

The checklist needs nothing from the founder to run. Three kinds of fix do. A change to brand colors, even one made to reach 4.5 to 1, is the founder's choice, so offer the nearest passing shade and let them pick. Replacing placeholder or invented content needs their real words, pictures and customers. And anything that costs money, such as a paid typeface or icon set, waits for them with a cost Estimate and a free alternative.

## If a tool is missing

If you have no screenshots, run the list from the markup and styles, mark what only a rendered page can show (overlap, cut-off text, real focus order) as not checked, and say so at the top of the report.

If you cannot compute a contrast ratio, give the two color values and write "not measured".

If you can read the page and cannot change it, hand the report to the author or your lead. Do not describe a miss as fixed.
