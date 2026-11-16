---
key: interface_design_principles
name: Interface design that is not generic
description: Guides the look of a customer-facing page or app so it fits its subject and does not read as a machine-made template.
category: design
attribute_name: Interface design
attribute_group: craft
when_to_use: Use when building or reshaping a customer-facing page or screen whose look is yours to decide, before writing markup or styles.
roles: frontend_engineer, design_to_code
default_for: design_to_code
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: example-skills:frontend-design, taste-skill:design-taste-frontend
license_note: Apache-2.0, Anthropic; MIT, Copyright (c) 2026 Leonxlnx
improves: design_principles, design_fidelity, component_craft
version: 1
---
# Interface design that is not generic

## When to use this

Use this when you build a page or screen that a founder's customers will see, on any stack, and the look is at least partly yours to decide: a project page, a small shop, a booking app, a sign-up flow.

If the project has a design reference or its own design system, that wins and this skill only fills the gaps. It also sits on top of your Design principles skill, which holds the measurable rules: the spacing scale, text sizes, contrast, states. This one covers the decisions that come before those rules, which decide whether the page looks made for this project or made by default.

## Before you start

1. **What the project already has.** Its components, tokens, brand colors, logo and fonts. Use them as given.
2. **The subject.** What is offered, to whom, and the one action the page asks for. Take it from the project's records: the idea in the founder's words, the positioning notes, the page copy.
3. **The real material.** Photographs, screenshots of the product, prices, an address, opening hours. List what exists and what does not.
4. **What should lead the page.** The kind of project decides it:

   | The project is | What leads |
   | --- | --- |
   | A place people come to (a cafe, a studio, a shop) | Photographs of the place and what it offers |
   | A physical product | The product itself, large, from more than one view |
   | A service people hire | The people and examples of the work |
   | Software | Its own screens, showing real content |

If the brief names a visual direction, follow it exactly, including when it asks for a look this skill lists as a default.

## Steps

1. **Write a short design plan before any markup.**
   - Color: four to six named values with a role each (page, text, quiet text, action, one accent). Check each text pair for contrast now.
   - Type: one family or two that are clearly different, the role of each, and the size scale.
   - Layout: one sentence per section and a rough sketch in text. State the alignment.
   - The one memorable thing: the single element that carries the character of the page.
2. **Test the plan against the defaults.** Ask of each part: would this same choice come out for any other project of this kind? If yes, it is a default. Go back to the subject and choose again from its world: its materials, its colors, its vocabulary. Note what you changed and why.
3. **Make the first screen say what this is.** A heading that names what is offered and for whom, one supporting fact, the main action, and the most characteristic real thing from the subject. A large number over a small label beside a gradient is the stock opening. Use it only when the number is the story.
4. **Let type carry the character.** Choose the typeface for this subject, not the one you would reach for on any project. Keep reading lines under about 80 characters. When a heading is the main visual, give it room and weight.
5. **Use structure only where it carries information.** Borders, dividers, numbers and labels each have to mean something. Number the steps only if the content is a real sequence. A small label above a heading has to add something the heading does not say.
6. **Hold color back.** Neutrals for most of the page, one color for actions, a second accent only where it carries meaning. Take the palette from the subject or from the founder's brand colors.
7. **Show real things.** Photographs and screenshots that belong to the project. A stock photograph is never passed off as the founder's product, place or people. If a stand-in is needed, list it in your report as a stand-in. No drawn imitation of another company's logo, and no invented reviews, customers or figures.
8. **Use motion to answer an action:** a menu opening, a row expanding, a save confirming. At most one arranged moment when the page loads. Nothing moves merely because the page scrolled, and with reduced motion switched on everything rests and nothing stays hidden.
9. **Treat words as part of the design.** Name things the way a customer would. A button says what happens: "Save changes", "Book a lesson". The same action keeps the same name through the whole flow. An error says what went wrong and how to fix it. An empty screen says what will appear there and offers the one action that fills it.
10. **Spend the boldness in one place.** One element is memorable and everything around it stays quiet. Before you finish, remove one decoration.
11. **Meet the floor.** Whatever the look, these hold:
    - Hierarchy: one main heading, one primary action per view.
    - Spacing: one scale, with equal left and right page edges.
    - Text contrast of at least 4.5 to 1, or 3 to 1 for large text.
    - Touch targets at least 44 px on touch screens.
    - Loading, empty and error states for every view that loads data.
    - Keyboard reach with a visible focus ring.
    - Works at 390 px wide with no sideways scroll, and at desktop width with a readable maximum line.
12. **Look at the result.** After a change to a page, the platform takes screenshots at desktop width and at 390 px, and a separate reviewer may return fixes. Apply the ones that suit the task and the project's own system, once, and say which you left and why.

Signs of a generic, machine-made look. Each is fine when the subject calls for it. Each is a tell when it appears whatever the subject:

| Area | The default |
| --- | --- |
| Palette | Cream background, serif headings and a clay-orange accent. Near-black with one acid-green accent. A purple-to-blue or purple-to-pink gradient. |
| Layout | Everything cut into identical rounded cards with the same soft shadow. Three feature cards with an icon each. A row of three or four big statistics under the opening. |
| Chrome | A small all-caps label above every heading. Details joined by middle dots. An arrow after every link. Monospace type for small labels. Numbered markers on things that are not a sequence. |
| Type | One word of the headline in italics or a second color. Gradient text. Headings made of two short fragments. |
| Motion | Every section fading and sliding up as it scrolls in. A hover effect on every card. Carousels. Tilting cards. |
| Decoration | Glass panels, glows, emoji used as icons, floating blurred shapes. |
| Content | Placeholder names, invented testimonials, a strip of logos that are not customers. |

## What good looks like

The founder fixes bikes from a garage in Bend, Oregon, and wants a page that takes repair requests.

The default version: a cream page, a serif headline with "down the street" in orange italics, "RELIABLE. LOCAL. FAST." in small capitals above it, three rounded cards with icons, a row reading "500+ bikes, 4.9 stars, 24 h", and every block fading in on scroll. Nothing on it says bikes, Bend or this person, and the figures are invented.

The specific version, from the plan:

```
Subject: bike repair by one person, in a garage, for neighbors. Action: request a repair.
Leads: the founder's own photograph of the workbench. None supplied yet,
  so the page opens on type alone. Listed as needed.
Color: workshop gray #2B2F33 (text), paper #F7F6F3 (page), quiet #5F666D,
  chain-oil green #1B4332 (actions, with white text).
Contrast: text on paper 12.5 to 1; quiet on paper 5.4 to 1; white on green 11 to 1.
Type: one sturdy sans in two weights; the headline at 40 px, body at 16 px.
Layout: left-aligned. Heading and request form share the first screen.
  Below: "What I fix" as a plain list with prices. Then where and when.
Memorable thing: the price list, set like a hand-lettered shop board.
Changed after the default test: dropped the three feature cards
  (the list says it better) and the statistics row (no real figures yet).
```

## Output

```
Design plan: color values and roles, type, layout by section, the memorable thing
Changed after the default test: what you replaced, and why
Contrast: each text pair with its ratio, or "not measured"
Material used: each photograph or screenshot and where it came from
Stand-ins and gaps: anything standing in for real material, and what the founder needs to supply
Not seen: any width or state you could not look at
```

## Check before you hand it over

- A stranger could tell from the first screen what is offered, for whom and what to do next.
- Each part of the plan was chosen for this subject. You can say why for each.
- None of the defaults in the table is present without a reason from the subject.
- One primary action per view. One memorable element.
- Text contrast is at least 4.5 to 1. Touch targets are at least 44 px.
- Loading, empty and error states exist and tell the customer what to do.
- With reduced motion on, nothing moves and nothing is hidden.
- It works at 390 px wide and at desktop width.
- Every word, figure, photograph and logo is real, or is listed as a stand-in.
- The project's own components, tokens and brand colors were used wherever they exist.

## What needs the founder

The founder's brand is theirs: the name, the logo, the brand colors and any change to them. So are photographs of the founder, the product and the place. Ask for these through your hand-back, with a list of exactly which pictures would help.

Anything that costs money waits for the founder: a paid typeface, licensed photographs, a paid icon set. Offer the free route first and give the paid one a cost Estimate. Publishing the page is approved by the founder.

## If a tool is missing

If you cannot see screenshots, check sizes, spacing and contrast from the styles, and say in your report that the page was not seen in a browser.

If the project has no photographs yet, design the page on type, flat color and real text, and list the pictures it needs. Do not fill the gap with stock.

If you cannot measure contrast, write "not measured" beside the pair. Do not claim it passes.
