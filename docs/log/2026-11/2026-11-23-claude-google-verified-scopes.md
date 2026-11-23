---
date: 2026-11-23
branch: claude/google-verified-scopes
title: Google scopes match the verification submission; Drive drops drive.readonly by default
areas: [connectors, api, docs]
---

## What changed
- Google Drive asks for `drive.file` and `documents` only (`GOOGLE_DRIVE_SCOPES`). `drive.readonly` is restricted at Google, so it is now `GOOGLE_DRIVE_READ_SCOPE`, asked for only when the connect input carries `readDrive: true`, as Gmail does with `readMail` and `gmail.readonly`. The api passes `readDrive` through for `google_drive` only.
- Drive connect now uses `exactScopes`, like Gmail, so a token holds only what that consent asked for.
- `search_files` returns `searched: "whole_drive" | "foundmill_files"` and its description tells agents that without Drive reading it covers only files Foundmill created or the founder opened with Foundmill. The live API does this by construction under `drive.file`; the mock now has a founder-only file (`DRIVE_FOUNDER_ONLY_FILES`) that search and `get_file` reach only with `drive.readonly`.
- `src/__tests__/google-verified-scopes.test.ts` pins the declared and consent-screen scopes of Gmail, Calendar and Drive to the submitted list. Calendar already asked for exactly `calendar.events` and `calendar.readonly`: confirmed, unchanged.
- docs/DEPLOY.md lists the submitted scopes and says `gmail.readonly` and `drive.readonly` come later. The Northwind seed's Drive record says `drive.file`, `documents` instead of `drive.readonly`.

## Decisions
### The existing mock fixtures count as files the founder opened with Foundmill
The golden path and contract suite read them, and under `drive.file` a file the founder opened with Foundmill is reachable, so they stay readable. One new fixture stands for the rest of the founder's Drive and is the one the scope gates.
### No Settings switch for Drive reading yet
The switch is the `readDrive` connect input. Google would refuse the unverified restricted scope anyway, and a button would touch a screen; it lands with the later `drive.readonly` submission.

## Not done
- A Settings › Integrations toggle for Drive reading (see above).
- Mapping Google's 404 for a file outside `drive.file` to a plainer message.
