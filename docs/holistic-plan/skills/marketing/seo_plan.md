---
key: seo_plan
name: First 90 days of search
description: Plans what a new project does about search in its first 90 days, and says plainly what will not pay off yet.
category: marketing
attribute_name: Search planning
# us-english-allow: attribute_group is an enum key, spelled this way in the product's code
attribute_group: judgement # us-english-allow
when_to_use: Use when asked for a search plan, how people will find the project on a search engine, or what to do about search first.
roles: channel_seo
default_for: channel_seo
stage: page_live, first_followers, first_sale
needs: web_research, search_console, analytics
adapted_from: claude-seo:seo-plan, marketing-skills:seo-audit
license_note: MIT, Copyright (c) 2026 agricidaniel; MIT, Copyright (c) 2025 Corey Haines
version: 1
---
# First 90 days of search

## When to use this

Use this when a founder asks how people will find the project through a search engine, when you take on search for a project and need a first plan, or when the last plan is 90 days old.

Do not use it to check one page in detail, to research topics in depth or to write a brief. Those have their own skills. This plan decides what happens in what order, and what waits.

## Before you start

Search is slow. A new page can take days or weeks to appear in results at all, and months to be found for anything other than its own name. Say this in the plan. A founder who expects visitors in week two stops trusting every number after that.

Read these first:

1. The idea in the founder's words, who it is for, and where: a town, a region, or anywhere online.
2. What exists today. Most week-one projects have one public page at a hosted address and nothing else: no domain of their own, no analytics, no budget, and no site-owner console (the search engine's free dashboard for a site's owner, such as Search Console). As of 2026 a console asks the owner to prove control of the whole site, which a hosted address rarely allows. Check the current rule before you plan around console data.
3. What you can use. Write one line: `Connected: page reader, search results, console, analytics`, each with yes or no.

Then name the situation in one line:

| Situation | What exists | The plan's job |
| --- | --- | --- |
| A. One hosted page | A public page, nothing connected | Page basics, one topic, listings |
| B. Own site, new | A domain with a few pages and under three months of history | The same, plus a first small group of pages |
| C. Site with history | Search data for three months or more | Improve what already shows up before starting anything new |

## Steps

1. **Write the search goal as two plain sentences.** In situation A it is nearly always: "Someone who searches the project's name finds the page first. Someone who searches {one specific phrase} can find it." Anything bigger belongs to a later plan.
2. **Fix the basics in this order.** Each one is wasted if the one before it fails.

   | Order | Question | On a hosted page |
   | --- | --- | --- |
   | 1 | Can a search engine reach the page and index it (add it to the pages it can show)? | It is public, answers at its address and carries no `noindex` tag, which asks to be left out of results |
   | 2 | Does it read well on a phone? | Read it at phone width |
   | 3 | Do the title and description say what it is and for whom? | These are usually built from the project's name, its one-line pitch and the start of its About text. Read the live HTML to confirm, then propose wording |
   | 4 | Does the page answer what the searcher wanted? | What it is, who it is for, how it works, what it costs or when it starts, who is behind it |
   | 5 | Does anything link to it? | Step 5 |

3. **Choose one phrase.** Build it from what the project is plus who or where: "mobile bike repair Bend", "sourdough class Tacoma", "budget planner for students". If you can run searches, read the first results page for it.

   | What the results show | Decision |
   | --- | --- |
   | National brands and marketplaces fill the page | Narrow the phrase by place, audience or use |
   | Small sites, local listings and forum threads appear | Keep it |
   | Nothing matches what the project does | People use other words. Take them from customer messages in the records |

   With no search tool, take the phrase from the founder's and customers' own words and mark it `Assumption, not checked against results`.
4. **Choose one topic the founder knows first-hand.** Plan three to five pieces on it across the 90 days: one main piece, and two to four that each answer a single question. Every piece holds something only this founder can say: a price they charge, a mistake they made, a photo of their work, a count from their own records. If the project has only its hosted page, the topic lives in the page's own words and in posts elsewhere that link to the page. Plan separate pages once the project has somewhere to publish them.
5. **List five to ten free places where the project belongs.** A map listing for a local service, a directory for its kind of app or craft, a community's member list, the founder's own profiles. The name, one-sentence description, address and phone are the same everywhere, character for character. Keep listings that are free, relevant and curated by a person. Drop any that sell placement or publish whatever is submitted.
6. **Lay the 90 days out in three blocks.**

   | Days | Work | Done when |
   | --- | --- | --- |
   | 1 to 14 | Basics from step 2. Phrase chosen. Listings drafted | The page passes a page check and the founder has the listing tasks |
   | 15 to 45 | Main piece published. Listings live. First supporting piece | The page shows up for the project's name |
   | 46 to 90 | Remaining pieces. One review of what moved | The review is written and the next plan starts from it |

7. **Say what not to bother with yet, with one line of reason each.** For a week-one project the list is usually:
   - A domain bought only for search. A new domain starts with no history, so it brings visitors no sooner, and the purchase is the founder's to make.
   - Paid search tools. The free route covers 90 days.
   - Link outreach campaigns. Listings and people the founder already knows come first.
   - Many near-identical pages for towns or keywords. As of 2026 search engines' spam rules call these doorway pages (pages made to rank, with nothing new on them).
   - Speed scores, structured data beyond the basics, and other languages.
   - Daily position checks. Positions move for reasons nobody outside the search engine can see.
8. **Set the measures.** A result is something a person did after arriving from search: a follow, a signup, a reply, a sale, taken from attribution or analytics. Positions, impressions (times the page was shown in results) and "the page is indexed" are leading signs and are labeled so. Any number that is not real data is labeled Forecast or Estimate.
9. **Change one thing at a time, then wait.** After a change to a page, allow three to four weeks before judging it. Two changes in one week cannot be told apart.
10. **In situation C, start from the data.** Take query and page pairs for the last 28 days.

    | What you see | Fix |
    | --- | --- |
    | Average position 8 to 20 | Write the missing section, and link to the page from the strongest related pages |
    | Position 1 to 5 with few clicks | Rewrite the title and description only |
    | Two pages showing for one query | Pick one owner, merge the other into it and redirect |

    If two rounds of edits move nothing, stop editing. The page is held back by intent or by links, and more wording fixes neither.

## What good looks like

A founder wrote: "I teach sourdough in my kitchen in Tacoma on Saturdays. Six people a class."

```
Situation: A. Connected: page reader yes, search results no, console no, analytics no.
Timing: expect almost no search visitors before day 60 (Forecast). The first 90 days make the page findable.
Goal: a search for "Second Rise Tacoma" finds the page first. A search for "sourdough class Tacoma" can find it (Assumption, not checked against results).
Basics: the title reads "Second Rise: bread, together". Proposed pitch: "Saturday sourdough classes in Tacoma", which makes a 49-character title.
Topic: keeping a starter alive in a cold kitchen. Main piece, plus "why my starter smells like nail polish" and "what to bake in week one".
Listings: map listing, the neighborhood business list, two local class calendars. Four founder tasks.
Not yet: a domain, paid tools, pages for Seattle and Olympia.
Measures: follows from the page (result). Page found for its name by day 45 (leading sign, Forecast).
```

## Output

```
Situation: A, B or C, with one line of evidence
Connected: page reader, search results, console, analytics
Timing: one or two sentences the founder can read
Search goal: two sentences
Basics: the five questions, each pass or the fix
Phrase: the phrase, with its evidence or "Assumption"
Topic: main piece and supporting pieces, each with the first-hand detail it needs
Listings: place, why it fits, who does what
90 days: the three blocks
Not yet: each item with its reason
Measures: results, leading signs, labels
Founder tasks: each with exact steps
Not checked: what you could not verify, and why
```

Where a person or organization in the plan exists as a record, write it in the mention format you already use.

## Check before you hand it over

- The plan says in plain words that search takes months.
- It has one phrase and one topic, and no more.
- Every piece names the first-hand detail it depends on, or carries `[NEED: ...]`.
- The "not yet" list is there, with reasons.
- No position, impression or index status is reported as a result.
- Every number that is not real data is labeled Forecast or Estimate.
- Each listing is free, relevant and curated. None sells placement.
- Nothing in the plan depends on a tool that is not connected, unless a founder task covers it.

## What needs the founder

The founder approves the plan. Every change to a live page ships through the project's normal review and the founder's approval. Opening an account, claiming a listing, agreeing to a site's terms, proving ownership of a site and buying a domain are the founder's to do: write each one as a founder task with exact steps. Anything published in the founder's name waits for them.

## If a tool is missing

- No page reader: work from the page text in the records and write "not checked on the live page" beside each basic you could not see.
- No search results: the phrase is an assumption, and the plan says so. State no search volumes and no positions.
- No console: whether the page is indexed becomes a founder task. They search for the page's exact address and for the project's name, and tell you what appears. Impressions and clicks are reported only from figures the founder gives you.
- No analytics: report follows and signups from the records, and say you cannot tell which came from search.

Never describe a listing as live or a page as indexed unless a tool result or the founder says so.
