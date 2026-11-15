/**
 * Canned Vercel answers, shaped as documented at https://vercel.com/docs/rest-api/deployments (read Nov 12, 2026).
 * They carry fields the connector must never pass on (env, meta blobs, creator emails) so tests can prove it does not.
 */
import { MOCK_NOW } from "../../../mock-utils";
import type { VcDeployment } from "../tools";

export const PROD_ID = "dpl_8RkQmZ2xVf3nTbYhLw5cAeJp9sUd";
export const PREVIEW_ID = "dpl_3HnWb7QeKt1yCzXa6MvRgDs4FuLj";
export const OLD_PROD_ID = "dpl_5TgYc9LpNa2vQwEr8KxBhJm1ZsUf";
export const PROD_HOST = "northwind-web-7k2m9x.vercel.app";
export const PREVIEW_HOST = "northwind-web-git-fix-checkout-northwind.vercel.app";
export const OLD_PROD_HOST = "northwind-web-q4p8dz.vercel.app";

export const TEAM_ID = "team_nllPyCtREAqxxdyFKbbMDlxd";

/** Fields that must never reach an agent. */
export const SECRET_ENV = "STRIPE_SECRET_KEY=sk_live_do_not_leak";

const DAY = 86_400_000;
/** Two days before the mock clock, so a mock redeploy (made "now") sorts newest. */
const T0 = MOCK_NOW.getTime() - 2 * DAY;

export const VC_PROD: VcDeployment & Record<string, unknown> = {
  uid: PROD_ID,
  name: "northwind-web",
  url: PROD_HOST,
  state: "READY",
  readyState: "READY",
  target: "production",
  created: T0,
  createdAt: T0,
  ready: T0 + 94_000,
  inspectorUrl: "https://vercel.com/northwind/northwind-web/8RkQmZ2xVf3nTbYhLw5cAeJp9sUd",
  alias: ["northwindskincare.com", "www.northwindskincare.com"],
  creator: { uid: "user_1", email: "founder@example.com", username: "northwind" },
  env: [SECRET_ENV],
  build: { env: [SECRET_ENV] },
  meta: {
    githubCommitRef: "main",
    githubCommitSha: "9f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d",
    githubCommitMessage: "Add the quarterly refill page",
    githubCommitAuthorEmail: "founder@example.com",
    secretNote: SECRET_ENV,
  },
};

export const VC_PREVIEW: VcDeployment & Record<string, unknown> = {
  uid: PREVIEW_ID,
  name: "northwind-web",
  url: PREVIEW_HOST,
  state: "ERROR",
  readyState: "ERROR",
  target: null,
  created: T0 + DAY / 2,
  createdAt: T0 + DAY / 2,
  errorMessage: "Command \"pnpm build\" exited with 1",
  inspectorUrl: "https://vercel.com/northwind/northwind-web/3HnWb7QeKt1yCzXa6MvRgDs4FuLj",
  alias: [],
  meta: { githubCommitRef: "fix-checkout", githubCommitSha: "0a1b2c3d4e5f60718293a4b5c6d7e8f901234567", githubCommitMessage: "Fix checkout total rounding" },
};

export const VC_OLD_PROD: VcDeployment & Record<string, unknown> = {
  uid: OLD_PROD_ID,
  name: "northwind-web",
  url: OLD_PROD_HOST,
  state: "READY",
  readyState: "READY",
  target: "production",
  created: T0 - 6 * DAY,
  createdAt: T0 - 6 * DAY,
  ready: T0 - 6 * DAY + 81_000,
  inspectorUrl: "https://vercel.com/northwind/northwind-web/5TgYc9LpNa2vQwEr8KxBhJm1ZsUf",
  alias: [],
  meta: { githubCommitRef: "main", githubCommitSha: "5555555555555555555555555555555555555555", githubCommitMessage: "Launch page copy" },
};

export const VC_DEPLOYMENTS = [VC_PROD, VC_PREVIEW, VC_OLD_PROD];

export const LIST_OK = { deployments: VC_DEPLOYMENTS, pagination: { count: 3, next: null, prev: 1_773_000_000_000 } };
export const USER_OK = { user: { id: "AEIIDYVk59zbFF2Sxfyxxmua", username: "northwind", name: "Northwind", email: "founder@example.com", billing: { plan: "hobby" } } };
export const TEAM_OK = { id: TEAM_ID, slug: "northwind", name: "Northwind Skincare", billing: { plan: "pro" }, inviteCode: "hasihf9e89" };
export const CREATED_OK = { id: "dpl_89qyp1cskzkLrVicDaZoDbjyHuDJ", url: "northwind-web-n3w8d1.vercel.app", readyState: "QUEUED", target: null, inspectorUrl: "https://vercel.com/northwind/northwind-web/89qyp1cskzkLrVicDaZoDbjyHuDJ", alias: [], env: [SECRET_ENV] };

export const UNAUTHORIZED = { error: { code: "forbidden", message: "Not authorized: Invalid token" } };
export const RATE_LIMITED = { error: { code: "too_many_requests", message: "Rate limit exceeded" } };
