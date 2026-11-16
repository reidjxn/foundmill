---
key: structured_data
name: Structured data
description: Writes and checks the machine-readable description of a page so search engines and AI readers get its facts right.
category: marketing
attribute_name: Structured data
attribute_group: craft
when_to_use: Use when asked to add, fix or check schema markup or JSON-LD, which type fits a page, or whether a piece of markup is allowed.
roles: channel_seo, channel_geo, frontend_engineer
default_for:
stage: page_live, first_sale, growing
needs: repo, web_research
adapted_from: claude-seo:seo-schema, marketing-skills:schema
license_note: MIT, Copyright (c) 2026 agricidaniel; MIT, Copyright (c) 2025 Corey Haines
improves: structured_data, technical_seo
version: 1
---
# Structured data

## When to use this

Use this when a page needs structured data, when existing markup has to be checked, or when someone asks whether a type is allowed or worth having. Structured data here means JSON-LD: a small script in the page that states the page's facts in the schema.org vocabulary so a machine can read them.

It helps a search engine or an AI reader get the name, place, price and dates right. It does not make a page rank, and it earns a special result only for the types a search engine supports at the time. Say both when you propose it.

Do not use it to write the page's words or to audit a whole site. Those have their own skills.

## Before you start

1. Read the page and list what a visitor can see: the name, what it is, the price, the place, hours, dates, who is behind it. Structured data may state these and nothing else.
2. Match each item to a project record. The record is the source.
3. Find out who can change the page's HTML. On a hosted project page the host writes the markup, so your output is a request to your lead with the block attached. On a site in a repository it ships as a pull request (a proposed code change, reviewed before it goes live).
4. Look for existing markup: `<script type="application/ld+json">` blocks, and `itemscope` or `typeof` attributes from the two older formats. Some page readers strip scripts. If yours does, write "could not see scripts", never "no structured data found".

## Steps

1. **Choose the type from what the page is.**

   | The page is | Type | Must have | Use when true and visible |
   | --- | --- | --- | --- |
   | The project or business itself | `Organization` | `name`, `url` | `logo`, `description`, `sameAs` |
   | A local service with a public address | `LocalBusiness` or a more specific subtype | `name`, `address` | `telephone`, `openingHours`, `geo`, `areaServed`, `priceRange` |
   | An app | `SoftwareApplication` or `WebApplication` | `name`, `offers` | `applicationCategory`, `operatingSystem` |
   | A product for sale | `Product` | `name`, `image`, `offers` with price, currency and availability | `brand`, `sku` |
   | An article or a newsletter issue | `Article` or `BlogPosting` | `headline`, `image`, `datePublished`, `author` | `dateModified`, `publisher` |
   | A class or an event | `Event` | `name`, `startDate`, `location` | `offers`, `organizer` |
   | The person behind it | `Person` | `name` | `url`, `sameAs` |
   | A page inside a larger site | `BreadcrumbList` | `itemListElement` | |

   A founder who works from home may not want that address public. A home address and a personal phone are personal data: they go in markup only when the founder has already chosen to show them on the page. Without a public address, use `Organization` with `areaServed` naming the towns served.
2. **Check what the search engine supports today before you promise a visible result.** A valid schema.org type and a supported result are different things. On Google, as of 2026:
   - Results for lists of questions (`FAQPage`) were retired for all sites in May 2026.
   - How-to results (`HowTo`) were retired in 2023, and the site search box in 2024.
   - Several smaller types lost their results in 2025: course details, fact checks, estimated salary, learning video, special announcements and vehicle listings.

   Check Google's current list of supported types, because it changes every year. Never propose `FAQPage` or `HowTo` to win a result feature. Existing `FAQPage` markup that matches questions shown on the page can stay: note it and move on. `QAPage` is for a page where visitors post answers to one question, and does not fit a list of questions the project wrote itself.
3. **Write one JSON-LD block.** `@context` is `https://schema.org`. Every node has a `@type`. Web addresses are absolute. Dates are ISO 8601, such as `2026-11-21`. Fixed values are exact, such as `https://schema.org/InStock`. Several types go in one block under `@graph`: that wrapper needs no `@type`, and its entries take `@context` from the top. No placeholder text ships.
4. **Hold every value to the page.** Each value is visible on the page and backed by a record. Review and rating markup is only for real customer reviews that a visitor can read on the page, and words the project wrote about itself do not qualify. An `offers` block matches the visible price and availability. When the page changes, the block changes in the same change.
5. **Keep the name identical everywhere.** The name, description, founder name and place in the block match the page word for word. `sameAs` lists only profiles the project controls. A different spelling in one place can make a search engine treat the project as two things.
6. **Put the block in the HTML the server sends.** Markup that a script writes in after loading may be read late or missed, and price and availability are the values most at risk.
7. **Validate, then grade what you find.** The block parses as JSON. The type's required properties are present. Each value matches the visible page. If you have a validator tool, run it and record the result.

   | Finding | Severity |
   | --- | --- |
   | Markup states something the page does not show, or a review, rating or offer that is not real | Critical. Take it out in the next change |
   | Invalid JSON, a missing `@context` or `@type`, a missing required property | High |
   | A relative address, a wrong date format, placeholder text left in | High |
   | An optional property that is true, visible and absent | Low |
   | A retired type that matches visible content | Note only |

## What good looks like

A founder sells hand-poured candles from one product page.

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Pine and smoke soy candle, 8 oz",
  "image": "https://wickandtin.example/img/cedar-smoke.jpg",
  "description": "Hand-poured soy candle in a reusable tin. Burns about 40 hours.",
  "brand": { "@type": "Brand", "name": "Wick and Tin" },
  "offers": {
    "@type": "Offer",
    "price": "18.00",
    "priceCurrency": "USD",
    "availability": "https://schema.org/InStock",
    "url": "https://wickandtin.example/cedar-smoke"
  }
}
```

```
Value          On the page                  Record
name           the page heading             product record
price 18.00    "$18" beside the button      price list, Nov 3, 2026
40 hours       second paragraph             founder's burn test note
InStock        "Ready to ship"              stock count of 12
Left out: aggregateRating. The page shows no customer reviews.
Will do: let a search engine read the price and stock correctly.
Will not do: guarantee a price or stock label in results. Support checked Nov 15, 2026.
Validation: parses, required properties present, values match. Not run through a validator.
```

## Output

```
Page: address and what it is
Existing markup: what you found, or "could not see scripts"
Type: the type chosen, and why
Block: the JSON-LD
Value map: each value, where it shows on the page, the record behind it
Left out: properties you did not use, and why
Validation: parses, required properties, matches the page, validator result or "not run"
What it will and will not do: one line each, with the date you checked support
How it ships: a pull request, or a request to your lead for a hosted page
```

## Check before you hand it over

- Every value is visible on the page and has a record behind it.
- The block holds no review, rating, offer, award or date that is not real.
- Support for the type was checked today, or the hand-back makes no promise about results.
- `FAQPage` and `HowTo` are not proposed for a result feature.
- The block parses, its web addresses are absolute and its dates are ISO 8601.
- A home address or a personal phone appears only where the founder already shows it.
- Nothing says the markup will improve position. Any figure you did not measure is labeled Estimate.

## What needs the founder

The founder approves the facts that become machine-readable: address, phone, price, hours. The founder decides whether a home address or a personal phone is public at all. The change itself ships through the project's normal review and the founder's approval, never straight to a live page. If the hand-back mentions a position in results, it calls it a leading sign.

## If a tool is missing

- Your page reader strips scripts: write "could not see scripts" and ask an engineer, or read the template in the repository.
- No repository: hand the block over as text and say plainly that it is not on the page.
- No validator: do the three checks in step 7 by hand and write "not run through a validator".
- Hosted page: the host controls the markup. Send the block to your lead as a request, and do not describe the page as marked up.
