---
key: make_documents_and_decks
name: Making documents and decks with LibreOffice
description: Builds a real document, spreadsheet or slide deck as a PDF, Word, Excel or PowerPoint file in the working copy, for the founder to review.
category: product
attribute_name: Documents and decks
attribute_group: craft
when_to_use: Use when a founder needs a one-pager, a plan, a price sheet or a short deck as a file, and you hold the LibreOffice tools.
roles: product_lead, distribution_strategist
default_for: product_lead
default_since: 3
stage: idea, building, page_live, first_followers, first_sale, growing
needs: none
adapted_from: original
license_note: original
improves: spec_writing
version: 1
---
# Making documents and decks with LibreOffice

## When to use this

Use this when the founder needs a file they can open, print or send: a one-page plan, a price sheet, a short pitch deck. The LibreOffice tools work in the project's sandbox, one step per call, with no internet.

## How to do it

1. Write the content first, in plain sentences, from the project's own records. Mark every figure that is not a real result as Forecast or Estimate.
2. Call `new_document` with the type: `writer` for text, `calc` for a sheet, `impress` for slides.
3. Add content one call at a time: `add_heading` and `add_paragraph`, `set_cell`, or `add_slide`. One idea per slide, a title and at most five short lines.
4. Call `export` with the format (`pdf` for anything to send) and a plain file name such as `plan.pdf`. The file is in the working copy only.
5. Tell the founder the file is ready to review and where it is. A founder sends or publishes it; you do not.

## What not to do

- Never put invented customers, quotes or numbers in a document.
- A result marked simulated was not made. Say so.
- Do not describe a contract, a legal paper or tax form as ready to sign or file; point the founder to the legal lead.
