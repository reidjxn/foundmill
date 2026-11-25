---
key: error_reports_sentry
name: Error reports with Sentry
description: Wires an app or page the team built to the founder's own Sentry project, proves a report arrives, and sends the founder a direct link to the reports.
category: engineering
attribute_name: Error reports
attribute_group: execution
when_to_use: Use when an app or page with code is about to reach customers, or when customers hit errors nobody on the team can see.
roles: security_engineer, infra_engineer, engineering_lead
default_for: security_engineer
default_since: 7
stage: building, page_live, first_followers, first_sale, growing
needs: repo
adapted_from: original
license_note: original
improves: observability, security_awareness
version: 1
---
# Error reports with Sentry

## When to use this

Use this when something the team built with code is about to be used by real people, or already is, and nothing records the errors they hit. Sentry is a service that collects those errors and groups them into reports. This skill covers wiring it in, proving it works, and telling the founder where to read the reports.

It does not cover reading the reports. The team has no tool that reads them yet, so the founder reads them in Sentry.

## Before you start

Have these in front of you:

1. The repository, and where the code runs: in the browser, on a server, in background work.
2. The founder's Sentry project key, called a DSN. It looks like `https://<key>@o<number>.ingest.sentry.io/<project number>`. It is made to be public and is safe in browser code. It is still configuration: it goes in the environment configuration, never typed into a source file.
3. What the app knows about its customers, so you can keep it out of the reports.

If there is no DSN in the project's records, ask the founder once, as one Needs you item, and continue with everything that does not need it:

- Sentry has a free plan (as of 2026; the founder checks the current terms).
- The founder creates the account and the project and accepts Sentry's terms. You never do that for them.
- The one thing to bring back is the DSN, shown on the last screen of creating the project.

## Steps

1. **Pick the official Sentry package for the framework in use.** One package for each place the code runs. Pin the version. Never write your own reporting client.
2. **Read the DSN from the environment configuration.** With no DSN set, reporting is off and the app runs as before. Never fail a start because the DSN is missing.
3. **Keep customers out of the reports.** Leave the option that sends personal data off. Before a report is sent, remove email addresses, names, phone numbers, payment details, tokens and the text of forms. Never record what a customer types or a replay of their screen.
4. **Mark each report** with the environment (preview or live) and the release, so a report can be tied to a change.
5. **Write the test first.** A unit test that an error reaches the reporting call, and that a customer's email address in the error is gone from what is sent.
6. **Send one test error** from the deployed preview, on purpose, with a message that says it is a test.
7. **Build the direct link.** The project number is the last part of the DSN. The link is:

   `https://sentry.io/issues/?project=<project number>&query=is%3Aunresolved`

   It opens the list of that project's open reports. A person who is not signed in to Sentry is asked to sign in and then lands on the same list.
8. **Write the note to the founder** (see Output). Send it to their inbox.

## What good looks like

Maya's team built a small booking app for her Sunday math hour. The agent adds the Sentry package for the browser and the server, reads the DSN from the environment configuration, strips parents' names and email addresses before sending, and adds the unit test. It sends one test error from the preview. The note to Maya has one link, and that link opens the reports for her project.

## Output

A branch with the change and its test, and a note to the founder in this shape:

```
Subject: Error reports are on for <what was built>

What changed: when something breaks for a customer, a report now goes to your Sentry project.
See the reports: <the direct link>
What I did to check: sent one test error at <time>. <"It shows in the list" only if you or a tool saw it; otherwise "Open the link to confirm you see it.">
What is kept out: customers' names, email addresses and anything they type.
Reading them here: today the team cannot read these reports. <If Settings › Integrations offers a Sentry connection: "If you keep using Sentry and want the team to read them for you, connect your own Sentry key in Settings › Integrations." Otherwise: "If you want the team to read them for you, ask for it with Request an integration in Settings › Integrations.">
```

## Check before you hand it over

- The link contains the project number from the DSN and nothing the founder has to search for.
- The DSN is read from the environment configuration and appears in no source file.
- With no DSN, the app still starts and works.
- The test proves a customer's email address is removed before sending.
- The note says a report arrived only if a tool result or the founder confirmed it.
- No Sentry setting was changed and no account was created by the team.

## What needs the founder

Creating the Sentry account and project, accepting Sentry's terms, any paid plan, and every setting inside Sentry (who has access, alerts, how long data is kept). Prepare each as one read and one action. Nothing here waits on the founder except the DSN: do the rest first.

## If a tool is missing

- No repository tool: write the change as a patch with the test, and say it is not applied.
- No way to deploy a preview: say the test error was not sent, and ask the founder to open the link after the next release.
- No DSN yet: ship the change with reporting off, and say in the note that it turns on when the DSN is set.
