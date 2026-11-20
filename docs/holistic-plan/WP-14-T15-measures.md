# WP-14 T15: three measures for the waitlist, each with a stop rule

Written Nov 17, 2026 with T15 steps 1 to 3 and 5. These are the three measures of T15 step 6. Each says what is compared, where the figures come from, whether it can be read today, and the rule that stops it. The founder confirmed the three stop rules (M1 to M3) on Nov 19, 2026. None is a target.

"Activated" means what the nightly numbers already mean by it (`@foundmill/shared` `founder-return.ts`, WP-02 T10): the person's project has its specification and its roadmap signed off and the founder pressed Continue once, all inside the activation window after commit. A person with no project is not activated.

The figures are read by hand for now. `packages/db/src/repos/metrics.ts` and `metrics-report.ts` are being changed by #208, #217 and WP-14 T12, so nothing was added to the nightly report; when those merge, measure 1 and the batch half of measure 2 can move into it as two more groups.

## 1. Activation by personal note against the standard email

- **What:** of the people a batch admitted, the share activated within 14 days of admission, for those the founder wrote a personal note to against those who got only the "Your place on Foundmill is open" email.
- **From:** `waitlist_entries.admitted_at`, `batch_id`, `notified_at` and `personal_note_at` (migration 0145; the operator records a note in docs/DEPLOY.md §4), joined to the person's projects.
- **Readable today:** yes, from the database, once a batch has been admitted and notes recorded.
- **How to keep it fair:** inside one batch, write to every second person in admission order (the founder's own action) rather than to the people who look most promising, or the note's effect cannot be told from the choice.
- **Stop rule:** read it 14 days after each batch. Stop writing personal notes when, over at least 100 people with a note and 100 without, the activated share with a note is less than 5 points above the share without. Stop reading it once the founder no longer writes notes. The card by post for one batch is read the same way, once, for that batch.

```sql
select (e.personal_note_at is not null) as personal_note, count(*) as admitted
from waitlist_entries e where e.batch_id is not null and e.admitted_at <= now() - interval '14 days'
group by 1;
```
The activated count per group comes from the 14-day activation report (`repos.presence`), filtered to the owners in each group.

## 2. Named invitations against waitlist batches: acceptance and activation

- **What:** of named invitations sent, the share accepted; of the people they let in, the share activated within 14 days; both beside the same activation share for people a batch admitted.
- **From:** the batch half from `waitlist_entries.batch_id` as above. The invitation half from `invitations` (when it was sent) and `account_admissions` (`how = 'invitation'`, `invitation_id`: the account it let in), which T15 step 4 uses for its cap of three.
- **Readable today:** the batch half, yes. The invitation half, yes, the same way; a link accepted by someone already in is not an admission and does not count.
- **Stop rule:** read it 30 days after named invitations ship and then monthly. If fewer than 20% of sent invitations are accepted after 200 have been sent, or the people they let in activate at a lower share than batch admissions over at least 50 of each, bring it to the founder: the three invitations are then costing places without bringing better founders. Stop reading it when sign-up opens to everyone, because an invitation then admits nobody who could not walk in.

## 3. Organic visits and sign-ups for the waitlist page

- **What:** visits to `/waitlist` that arrive from a search engine or an AI answer, and the share of those visitors who join the waitlist.
- **From:** visits need web analytics, which Foundmill does not have (WP-00 S12 is waiting on the founder's accounts). Search Console gives impressions and clicks for the page once the founder verifies foundmill.com there (WP-00 S7). Sign-ups are `waitlist_entries` rows, but a row does not say which page the person came from.
- **Readable today:** **no. It waits for analytics** (visits and the page a sign-up came from) and for Search Console (impressions and clicks). Total waitlist sign-ups per day are readable now and say nothing about the page on their own.
- **Stop rule:** once both exist, read it weekly for 8 weeks from the day the page is first indexed. If the page has had fewer than 100 organic visits in those 8 weeks, stop reading it weekly and leave the page as it is; the page costs nothing to keep. If it has visits and fewer than 5% join, change the page's words once and read 4 more weeks before deciding anything else. The page's exception to "indexing follows `SIGNUP_OPEN`" ends by itself when sign-up opens.
