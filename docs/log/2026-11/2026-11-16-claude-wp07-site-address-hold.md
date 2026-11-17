---
date: 2026-11-16
branch: claude/wp07-t7-pay-button
title: A site address a project gives up is held for 30 days (WP-07)
areas: [db]
supersedes: []
---
## What changed
- Migration `site_address_holds`: when a site's slug changes, or the site is deleted (its business deleted), the old
  slug is recorded; for `fm_site_address_hold_days()` days no other project's site may take it. The project that gave it
  up may take it back. Taking an address clears its hold.
- The refusal is a unique violation on `sites_slug_key`, the same answer as an address in use, so `site.setSlug`'s
  "That address is taken. Try another one." and `repos.sites.ensure` need no change.
- `packages/db/src/__tests__/rls/site-address-holds.test.ts`: rename, take back, 29 and 31 days, a deleted project, an
  unchanged slug, and that no app role reads or writes the table.

## Decisions
- **30 days, confirmed by the founder on Nov 16, 2026** (an Estimate when it was built). It is one value: the SQL function
  `fm_site_address_hold_days()`; a later migration replaces it to change the length.
- **Enforced in the database, not in the service:** the triggers catch every path (the founder's rename through RLS,
  the orchestrator's `ensure`, a deleted business) in one place, as 0078 does for retired mail addresses.
- **A platform table like `retired_mail_local_parts`:** the hold must outlive a deleted business, so the column is
  `released_by_business` with no foreign key, and no app role has a grant or a policy. A founder never needs to read it:
  a held address answers like a taken one.
- The hold does not say how long is left; "taken" is enough for a founder choosing an address.
- **Security review, fixed here:** only an address the public could have saved is held (the site is live, was ever
  published, or was taken down), so renaming a draft holds nothing; a business keeps at most 2 holds
  (`fm_site_address_holds_per_business()`), its newest, so renaming in a loop reserves no more; a taken-down site's
  address is held for good; both triggers take one per-address advisory lock, so a rename and a claim never pass each
  other.

## Not done
- No copy change and no screen: the existing refusal covers it.
- A site that was published, then unpublished (back to draft), and whose project is then deleted, may not be held: the
  check for a published release runs after the cascade removed the releases. Live and taken-down sites are held.
- No daily limit on renames in `site.setSlug` (T5's file); the cap of 2 holds makes renaming in a loop pointless.
