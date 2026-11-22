---
date: 2026-11-22
branch: claude/wp07-t12-previews
title: The merge review records the preview a connected repository already has (WP-07 T12)
areas: [connectors, orchestrator]
supersedes: []
---
## What changed
- `github` has a read tool `list_deployments` (`{ owner, repo, sha }` → `{ items: { environment, state, url }[] }`): GitHub's deployments for the commit, each with its newest status.
- `url` is kept only when it is https, has no user info and its host ends in `.vercel.app`, `.netlify.app` or `.pages.dev` (`previewProvider`); `error` reads as failure, anything unknown as pending.
- Real (Octokit) and mock (one Vercel preview per `agent/` branch head, failed for a failing branch) implementations, contract tests for both and the host filter.
- The App asks for `deployments:read` (`GITHUB_APP_SCOPES`), and the capability `deployments.read` maps to the tool. No template grants it.
- `assessMerge` reads the branch head's deployments on the merge's read-only token and emits `deploy.succeeded` (`environment: "preview"`, `provider` from the host, `url`, `commitSha`, `branch`, `taskId`) for the first successful one, with idempotency key `deploy:<taskId>:<sha>`: one event per head commit, none for a failed deployment, none twice.
- The Development tab's "See it" column already reads these events (`dev.deployments.list`).

## Decisions
### Not a route-only tool
- The package says "route-only". The gateway's `ROUTE_ONLY_TOOLS` refuses a tool on `/v1/call` for any token with a session, and the merge's tokens are minted in the task's session (it calls in the agent's name). So the tool is left off every grant instead: only the merge's read token names it.
### The first-party rule is unchanged
- The package lists `apps/gateway/src/code-repository.ts`. A deployment's environment and address come from the deployer, not from the business's code, so the tool stays a third-party read; the merge's token can only read, so the gateway returns the data, and the merge checks the address again before it stores it.

## Not done
- Production: Foundmill's GitHub App needs the Deployments (read) permission turned on in its settings, and installations accept it. Until then the live call is refused and the merge records nothing and carries on (best effort).
- Security review (two low hardening notes, not done): keep a deployment status only when its creator is the Vercel, Netlify or Cloudflare app, since anyone can hold a `*.vercel.app` host and a repository collaborator can post a status.
- And have the "See it" link (`PreviewLink`) or the `deploy.succeeded` schema accept https only. This change only ever writes https addresses on the preview hosts.
