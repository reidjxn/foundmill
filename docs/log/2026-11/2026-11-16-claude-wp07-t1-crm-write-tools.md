---
date: 2026-11-16
branch: claude/wp07-t1-crm-write-tools
title: Specialists can record a supplier and a note on it
areas: [connectors, gateway, agents, evals]
supersedes: []
---
## What changed
Two platform tools, `create_entity` and `log_interaction`, real (gateway host) and mock. Specialists and the product researcher hold them (`crm.entities.create`, `crm.interactions.append`).
A supplier is recorded once (same name and kind, case ignored), with its role and the page it was found on, and shows in Customers under `role:supplier`. Both are audited as the agent.
Tests: `platform.test.ts` (mock, validation, cross-business), `platform-crm.test.ts` (database host), eval case `sourcing_manufacturing.records_suppliers`.
The supplier task now asks for 10 suppliers "each with the page it was found on" (an Estimate of one session's reach), not 20 "CRM entities".

## Decisions
### Contact details are refused only when the session's sources were simulated
The tools refuse an email address or phone number in the name or note when `sessionSimulated` is true, so an invented company never gets a real-looking address. Real sessions may record them.
### The specialist description keeps "documents in Google Drive"
The work package asked to remove it, but specialists still hold a `google_drive` grant, so the sentence is true; only "new CRM records" was added.
### Another business's record reads as not found
`log_interaction` checks the record first and answers `not_found`, like every platform id, instead of the repository's validation error.

## Not done
"RFQ pack" acceptance has no tool yet (PLANNED_GRANTS.md rows for it stay). Operations lead and channel templates still lack the two grants.
