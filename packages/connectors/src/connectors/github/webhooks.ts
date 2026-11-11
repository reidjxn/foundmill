/**
 * GitHub App webhooks (docs.github.com/webhooks/using-webhooks/validating-webhook-deliveries): the
 * `X-Hub-Signature-256` header is `sha256=` + HMAC-SHA256(secret, raw body) in hex, compared in constant time.
 * `X-GitHub-Delivery` is unique per delivery and feeds the replay guard. `pull_request` closed+merged →
 * `pr.merged`; `push` and everything else verify but produce no platform event yet.
 */
import type { ConnectorWebhook, PlatformEvent } from "../../contract";
import { makeEvent } from "../../mock-utils";
import { header, hmacSha256, parseJsonBody, rawBody, type ReplayGuard, resolveBusinessId, safeEqual, webhookPath, type BusinessResolver } from "../../webhooks";
import { GITHUB_KEY, type GhPullRequest } from "./tools";

export const GITHUB_SIGNATURE_HEADER = "x-hub-signature-256";
export const GITHUB_DELIVERY_HEADER = "x-github-delivery";
export const GITHUB_EVENT_HEADER = "x-github-event";

export const githubSignature = (secret: string, body: string | Buffer): string => `sha256=${hmacSha256(secret, body, "hex")}`;

export interface GhWebhookPayload {
  action?: string;
  installation?: { id: number };
  repository?: { full_name: string; default_branch?: string };
  sender?: { login: string };
  pull_request?: GhPullRequest;
  ref?: string;
  after?: string;
  commits?: unknown[];
}

export interface GithubWebhookDeps {
  secret: string | null;
  resolveBusinessId?: BusinessResolver;
  replay?: ReplayGuard;
  now?: () => Date;
}

export function createGithubWebhook(deps: GithubWebhookDeps): ConnectorWebhook {
  // No guard of its own unless one is passed (the mocks pass one): `apps/ingest` holds the replay record and releases it
  // when a delivery is not stored, so a vendor's retry after a refusal or a failed write is accepted (SEC-11).
  const replay = deps.replay ?? null;
  return {
    path: webhookPath(GITHUB_KEY),
    async verify(req) {
      if (!deps.secret) return false;
      const signature = header(req, GITHUB_SIGNATURE_HEADER);
      const delivery = header(req, GITHUB_DELIVERY_HEADER);
      if (!signature || !delivery || !signature.startsWith("sha256=")) return false;
      const body = await rawBody(req);
      if (!safeEqual(githubSignature(deps.secret, body), signature)) return false;
      return replay ? replay.check(delivery) : true;
    },
    async accountOf(req) {
      const installation = parseJsonBody<GhWebhookPayload>(await rawBody(req))?.installation;
      return installation ? String(installation.id) : null;
    },
    async normalise(req) {
      const payload = parseJsonBody<GhWebhookPayload>(await rawBody(req));
      if (!payload) return [];
      const businessId = await resolveBusinessId(req, GITHUB_KEY, payload.installation ? String(payload.installation.id) : null, deps.resolveBusinessId);
      if (!businessId) return [];
      return normaliseGithubEvent(header(req, GITHUB_EVENT_HEADER) ?? "", payload, businessId, deps.now);
    },
  };
}

export function normaliseGithubEvent(eventName: string, payload: GhWebhookPayload, businessId: string, now: () => Date = () => new Date()): PlatformEvent[] {
  if (eventName !== "pull_request" || payload.action !== "closed") return [];
  const pr = payload.pull_request;
  const repo = payload.repository?.full_name;
  if (!pr || !repo || !pr.merged || !pr.merge_commit_sha) return [];
  const mergedAt = pr.merged_at ? new Date(pr.merged_at) : now();
  return [
    makeEvent("pr.merged", {
      businessId,
      occurredAt: mergedAt,
      actor: { kind: "webhook", id: GITHUB_KEY },
      seed: `${repo}#${pr.number}:${pr.merge_commit_sha}`,
      payload: {
        taskId: null,
        repo,
        prNumber: pr.number,
        title: pr.title.slice(0, 300),
        branch: pr.head.ref,
        baseBranch: pr.base.ref,
        mergeCommitSha: pr.merge_commit_sha,
        mergedBy: { kind: "webhook", id: payload.sender?.login ? `github:${payload.sender.login}` : GITHUB_KEY },
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        filesChanged: pr.changed_files ?? 0,
        url: pr.html_url,
      },
    }),
  ];
}
