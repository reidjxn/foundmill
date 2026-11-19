---
key: make_brand_assets
name: Making brand files with Inkscape and GIMP
description: Draws a logo or a graphic as a real SVG or PNG file from the project's brand colors, then asks the founder before it is used.
category: design
attribute_name: Brand files
attribute_group: craft
when_to_use: Use when the project needs a logo, a mark, a banner or another picture file, and you hold the Inkscape or GIMP tools.
roles: design_to_code, packaging_design, channel_content, channel_social
default_for: design_to_code, packaging_design
default_since: 2
stage: idea, building, page_live, first_followers, first_sale, growing
needs: none
adapted_from: original
license_note: original
improves: design_fidelity, artwork_specification
version: 1
---
# Making brand files with Inkscape and GIMP

## When to use this

Use this when a founder needs a real picture file: a logo, a mark, a social banner, a poster. You draw it with the Inkscape tools (vector, SVG or PDF) or the GIMP tools (raster, PNG or JPEG). Each tool call is one command in the project's sandbox. The sandbox has no internet.

## Before you start

1. Read the project's brand colors and name from its records. Use those exact hex values and no others for the main shapes.
2. Pick one program. Inkscape for a logo or anything that must scale. GIMP for a photo-like or pixel-exact picture.
3. Decide the size first. A logo is a square, 512 by 512.

## How to do it

1. Call `new_document` (or `new_image`) once.
2. Add shapes and text one call at a time, then check the result with the next call's summary. Keep the mark simple: one idea, at most three shapes, the primary brand color on a plain or secondary-color background, the name in text if it fits.
3. Call `export` with a plain file name that ends in the format, such as `logo.svg`. The file now sits in the working copy. It is not on the project's page and nothing has been sent.
4. Ask for approval with `release_output` (target `logo`). The founder sees an approval note and decides. Say in your report that the file is waiting for their approval, not that it is live.

## What not to do

- Never say a file is on the page before the founder approves it.
- Never use another company's logo, a font you cannot name, or colors the project does not have.
- A result marked simulated was not made. Say it was simulated and that no file exists.
- If a command fails, report the error in plain words and stop; do not try other commands to get around it.
