---
date: 2026-11-19
branch: claude/exciting-noether-vn7ca1
title: Send from your own domain (Path B of the domain plan)
areas: [db, connectors, gateway, api, web]
supersedes: []
---
## What changed
- Session 14 of docs/holistic-plan/LAUNCH_EVALUATION.md, Path B of docs/log/2026-11/2026-11-17-claude-wp08-domain-plan.md: a project can send its email from a domain the founder already owns.
- `project_domains` (migration 0147): one row per project with the domain, the name mail goes as there (`hello` by default), SendGrid's domain-authentication id, the DNS records to show with what the last check found, and `pending` or `verified`.
- Members read `project_domains` under RLS; no app role writes it. A partial unique index lets one project at most verify a domain. Cross-tenant test: `packages/db/src/__tests__/rls/project-domains.test.ts`.
- `sending_domain`, a service-only connector (real and mock) on the platform's SendGrid key: `authenticate_domain` (`POST /v3/whitelabel/domains` on the `em` subdomain, automatic security, three CNAMEs), `validate_domain`, `delete_domain`, and `check_records`, a DNS lookup for the records SendGrid does not check (CNAME, MX, TXT). Its mode follows `sendgrid`.
- One flow, `runOwnDomain` (packages/connectors `sending_domain/flow.ts`), adds, checks and removes the domain. The gateway runs it on the live connector at `POST /v1/domains/own` (`svc: api`); the api runs it on the mock when SendGrid is mock, so the golden path needs no gateway, as the Commit screen's domain check already does.
- Settings › Integrations › "Send from your own domain", under "Email from your project": the founders type the domain and the name, the panel lists each record (what it is for, type, name, value, each with a copy button, and the check's answer), "Check now" and "Remove domain". Collaborators see it read-only. The api audits each press (`integrations.own_domain_added`, `_checked`, `_removed`).
- Sending: once the domain is verified, `preparePlatformMail` sends from `<name>@<domain>` with the project's Foundmill address as Reply-To (`PlatformMailEnvelope.replyTo`), so replies still arrive in Customers. Every guard is unchanged: caps, suppression, consent, the unsubscribe link and the postal address.
- The site record: when the project has a Foundmill site, the panel shows `www.<domain>` CNAME `<slug>.<SITES_DOMAIN>` and checks it.

## Decisions
### No MX record in Path B
The task listed MX to Foundmill's inbound among the records. In Path B the founder already receives mail at the domain, and the Nov 17 plan says their MX is never touched; replies come back through the Foundmill Reply-To. So Path B shows no MX row. The MX to Foundmill's inbound, and name@ forwarding, belong to Path A, where Foundmill sets the records itself.

### The site record is shown and checked, not yet served
`apps/sites` resolves hosts under `SITES_DOMAIN` only, and a custom host needs its own certificate on Railway (unverified in the plan). The record is shown so the founder can add it once, and it is checked; serving the site at `www.<domain>` is its own change (sites host lookup and the certificate), left for Session 11 or a follow-up.

### The gateway writes the row in live mode, the api in mock mode
The vendor id never passes through the api in live mode. In mock mode the api writes on the service connection after the founder check (`isProjectFounder`), the same category as `project_mail`. A mock answer is never written for a person's project on staging or production (`mockResultsAllowed`), in either service, because a simulated "verified" would send as a domain nobody checked.

### A project's own ownership record (security review)
SendGrid's records are the same for every project on Foundmill's one SendGrid account, so passing its check proves the domain points at Foundmill, not which project chose it. Verification also needs TXT `_foundmill.<domain>` = `foundmill-verify=<sha256 of the project id and the domain>`. The value is not secret; only whoever controls the domain's DNS can publish it, and each project's differs.

### No downgrade, no claim of a taken domain (security review)
A verified domain stays verified when a later check fails, so a DNS or SendGrid hiccup never frees it for whoever checks next. Adding a domain another project sends from for real is refused before SendGrid is called. `business_id` is unique and only real verified rows are unique by domain, so a pending claim blocks nobody. Adding the same domain again changes only the sender name.

### Simulated rows, the column grant and the add cap (security review)
A row written from the mock is `simulated`: it never becomes the From of a live send and never holds the unique index. Members read the display columns only (a column grant), never SendGrid's id or `added_by`. The gateway allows ten adds a project a day, since each is an authentication on the shared SendGrid account.
- The business export (`repos.portability.page`) now asks only for a table's picked columns, so a table whose app-role grant covers some columns exports under RLS.

### No Storybook story
The panel is an app-level Settings section built from Dugout components, like the sections beside it, which have no stories; the Playwright spec covers it.

## Not done
- Path A (registration through Foundmill on OpenSRS): the next change on this branch.
- Serving the site at the founder's domain (see above).
- A verified domain is not re-checked on a schedule, and a failed check keeps it verified; if the founder later deletes the records, mail still goes from it. A periodic re-check that unverifies only on the ownership TXT going missing is the follow-up.
- Purging a business does not remove its domain authentication at SendGrid (hygiene only: the ownership record stops another project from using it).
- "Add these records for me" through Cloudflare DNS (+S in the plan).
