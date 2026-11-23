---
date: 2026-11-23
branch: claude/google-verified-scopes
title: Google scopes match the verification submission; Gmail asks for gmail.send only, Drive drops drive.readonly
areas: [connectors, api, web, docs]
---

## What changed
- Gmail asks for `gmail.send` only (`GMAIL_SCOPES`). Google's console marks `gmail.compose` restricted (founder's screenshot, Nov 23, 2026), so it joins `gmail.readonly` as a later opt-in: `readMail: true` asks for both.
- `create_draft`, `list_drafts` and `get_draft` refuse plainly without `gmail.compose`, live and mock (`GMAIL_DRAFTS_OFF`), and `withContextReads` takes them out of a session without it. Agents' drafts live in Foundmill: the note the founder approves, sent with `send_message`.
- Settings › Integrations' Gmail context line reads which of drafts and inbox Google granted (`gmailReadsLine`).
- Google Drive asks for `drive.file` and `documents` only (`GOOGLE_DRIVE_SCOPES`). `drive.readonly` is restricted at Google, so it is now `GOOGLE_DRIVE_READ_SCOPE`, asked for only when the connect input carries `readDrive: true`, as Gmail does with `readMail` and `gmail.readonly`. The api passes `readDrive` through for `google_drive` only.
- Drive connect now uses `exactScopes`, like Gmail, so a token holds only what that consent asked for.
- `search_files` returns `searched: "whole_drive" | "foundmill_files"` and its description tells agents that without Drive reading it covers only files Foundmill created or the founder opened with Foundmill. The live API does this by construction under `drive.file`; the mock now has a founder-only file (`DRIVE_FOUNDER_ONLY_FILES`) that search and `get_file` reach only with `drive.readonly`.
- `src/__tests__/google-verified-scopes.test.ts` pins (submitted: `gmail.send`, `calendar.events`, `calendar.readonly`, `documents`, `drive.file`) the declared and consent-screen scopes of Gmail, Calendar and Drive to the submitted list. Calendar already asked for exactly `calendar.events` and `calendar.readonly`: confirmed, unchanged.
- docs/DEPLOY.md lists the submitted scopes and says `gmail.readonly` and `drive.readonly` come later. The Northwind seed's Drive record says `drive.file`, `documents` instead of `drive.readonly`.

## Decisions
### One Gmail opt-in for both restricted scopes
`gmail.readonly` and `gmail.compose` go to Google in the same later submission, and both are reading the founder's own mail, so the existing reading switch (`readMail`) asks for both rather than adding a second switch. The agent grants keep `drafts.create`; the session drops the tools until the scope is granted.
### The existing mock fixtures count as files the founder opened with Foundmill
The golden path and contract suite read them, and under `drive.file` a file the founder opened with Foundmill is reachable, so they stay readable. One new fixture stands for the rest of the founder's Drive and is the one the scope gates.
### No Settings switch for Drive reading yet
The switch is the `readDrive` connect input. Google would refuse the unverified restricted scope anyway, and a button would touch a screen; it lands with the later `drive.readonly` submission.

## Not done
- A Settings › Integrations toggle for Drive reading (see above).
- Mapping Google's 404 for a file outside `drive.file` to a plainer message.
