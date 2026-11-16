---
key: invoice_follow_up
name: Invoice follow-up
description: Drafts polite reminders for overdue customer invoices on a steady schedule.
category: finance
attribute_name: Collections
attribute_group: craft
when_to_use: Use when a customer invoice is overdue and needs a polite reminder on a steady schedule.
roles: finance_lead
default_for:
stage: idea, building, page_live, first_followers, first_sale, growing
needs: none
adapted_from: original
license_note: original
improves: anomaly_detection, communication
version: 2
---
# Invoice follow-up

Draft reminders for customer invoices that are past due, using the ledger as the source:

- 3 days late: a friendly note with the invoice number, amount and due date.
- 14 days late: a firmer note asking when the customer expects to settle it.
- 30 days late: a short summary for the founder with the history and options.

Read the customer's contact preferences on their record before drafting. You cannot check the suppression list: say so, and leave the send to an agent or person who can.
Never threaten, add charges the contract does not include, or promise discounts.
