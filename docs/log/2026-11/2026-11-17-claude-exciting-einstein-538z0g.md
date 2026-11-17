---
date: 2026-11-17
branch: claude/exciting-einstein-538z0g
title: The plan document agrees with WP-14 (T13)
areas: [docs]
supersedes: []
---
## What changed
`docs/foundmill-plan/foundmill-plan.md`, the seed of Foundmill's own project, now agrees with WP-14 and the founder's
answers of Nov 17, 2026. Two principles were added (ten in all, the import limit). The value proposition leads with
what the founder gets, under "The team you could never afford". The first user has one goal, a first paying customer,
and the same sentence is the mitigation of the Scope risk. Retention gained "Working now", the chapter report and
Vacation mode as a headline feature. Supporting metrics gained T12's measures. Pricing was rewritten to T14 with
answers A1, A2 and A12 to A16. The go-to-market order has the eight steps, and a new Experiments section lists nine
tests, each with a stop rule. The file still passes `parsePlanFile` (checked by hand; no test reads the file).

## Decisions
### The brief itself is not in the repository, so the experiments come from WP-14
T13 asks for "the brief's B6.1 to B6.9". Only WP-14 is in the repository, and it names B6.2 to B6.5 and B6.9 by what
they measure. The nine experiments are the ones WP-14 describes in T10, T12, T14 and T15; they carry no B6 numbers,
because the mapping of four of them cannot be checked. The founder can correct the list against the brief.

### The stop rules' sizes and dates are proposals
WP-14 gives one stop rule in full (the ten-minute median for "within minutes") and asks for the others without
figures. The section says that its sizes and dates are proposals until the founder confirms them.

### Three lines outside T13's list were changed because they contradicted the founder's answers
Growth said a founder who brings someone "is credited": A7 says inviting earns no reward. Cost said plans "differ by
agent work": A2 and A14 replaced that. The roadmap item "Set Pro and Scale prices from measured cost" now names
Founder and Studio and the price test. Nothing else in the roadmap was touched.

### The description of the first user is unchanged
A10. No leaderboards (A8) and no mobile web view (A9) were added.

## Not done
- "Current state and known gaps" and the "Definition of done" paragraph (which still names docs/PROGRESS.md) are
  stale; the audit a11 records it and T13 does not ask for them.
- The "Next" roadmap item on the waitlist still says bringing someone moves a person up: T15 keeps the order inside
  a batch as WP-03 T10 built it unless the founder says otherwise.
- Re-importing the file into Foundmill's own project is the founder's step, in the product.
