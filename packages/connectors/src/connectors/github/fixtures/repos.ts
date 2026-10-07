/** Deterministic GitHub fixtures: two repositories (one per demo business, BUILD §17.2) with small trees. */
import { stableHash } from "../../../mock-utils";
import type { GhPullRequest, GhRepository } from "../tools";

export const MOCK_GITHUB_WEBHOOK_SECRET = "mock-github-webhook-secret";
export const MOCK_INSTALLATION_ID = 48213377;
export const MOCK_OWNER = "northwind-skincare";

export interface GhFixtureFile {
  path: string;
  content: string;
}

export interface GhFixtureRepo {
  repo: GhRepository;
  branches: Record<string, string>;
  files: GhFixtureFile[];
}

const blobSha = (path: string, content: string) => stableHash(`blob:${path}:${content}`, 40);
export const commitSha = (repo: string, branch: string, n: number | string = 0) => stableHash(`commit:${repo}:${branch}:${n}`, 40);

const NORTHWIND_FILES: GhFixtureFile[] = [
  { path: "README.md", content: "# Northwind Skincare — storefront\n\nNext.js storefront and subscription checkout for Northwind Skincare.\n\n## Scripts\n\n- `pnpm dev`\n- `pnpm test`\n" },
  { path: "package.json", content: JSON.stringify({ name: "northwind-site", private: true, scripts: { dev: "next dev", build: "next build", test: "vitest run" } }, null, 2) + "\n" },
  { path: "src/app/page.tsx", content: "export default function Home() {\n  return <main>Gentle skincare, delivered monthly.</main>;\n}\n" },
  { path: "src/lib/pricing.ts", content: "export const PLANS = { starter: 2900, pro: 4900 } as const;\n" },
  { path: "src/lib/checkout.ts", content: "import { PLANS } from \"./pricing\";\nexport const priceFor = (plan: keyof typeof PLANS) => PLANS[plan];\n" },
  { path: "tests/pricing.test.ts", content: "import { expect, it } from \"vitest\";\nimport { PLANS } from \"../src/lib/pricing\";\nit(\"has two plans\", () => expect(Object.keys(PLANS)).toHaveLength(2));\n" },
];

const LEDGERLY_FILES: GhFixtureFile[] = [
  { path: "README.md", content: "# Ledgerly\n\nBookkeeping for Nordic freelancers.\n" },
  { path: "package.json", content: JSON.stringify({ name: "ledgerly-app", private: true, scripts: { dev: "next dev", test: "vitest run" } }, null, 2) + "\n" },
  { path: "src/ledger/index.ts", content: "export interface Entry { date: string; amountMinor: number; account: string }\nexport const total = (xs: Entry[]) => xs.reduce((a, x) => a + x.amountMinor, 0);\n" },
  { path: "src/ledger/vat.ts", content: "export const VAT_RATE_SE = 0.25;\n" },
];

export const GH_REPOS: GhFixtureRepo[] = [
  {
    repo: { id: 812_004_117, full_name: `${MOCK_OWNER}/northwind-site`, name: "northwind-site", private: true, default_branch: "main", description: "Storefront and checkout", html_url: `https://github.com/${MOCK_OWNER}/northwind-site`, pushed_at: "2026-10-03T14:22:10Z", language: "TypeScript", owner: { login: MOCK_OWNER } },
    branches: { main: commitSha("northwind-site", "main"), "feat/annual-plan": commitSha("northwind-site", "feat/annual-plan", 3) },
    files: NORTHWIND_FILES,
  },
  {
    repo: { id: 812_004_221, full_name: `${MOCK_OWNER}/ledgerly-app`, name: "ledgerly-app", private: true, default_branch: "main", description: "Ledgerly web app", html_url: `https://github.com/${MOCK_OWNER}/ledgerly-app`, pushed_at: "2026-09-28T09:05:44Z", language: "TypeScript", owner: { login: MOCK_OWNER } },
    branches: { main: commitSha("ledgerly-app", "main") },
    files: LEDGERLY_FILES,
  },
];

export const fileSha = (f: GhFixtureFile) => blobSha(f.path, f.content);

export const GH_MERGED_PR: GhPullRequest = {
  number: 41,
  title: "Add annual plan to pricing",
  body: "Adds the annual plan and its tests.",
  state: "closed",
  draft: false,
  merged: true,
  mergeable: null,
  merged_at: "2026-10-04T16:40:00Z",
  created_at: "2026-10-04T10:12:00Z",
  html_url: `https://github.com/${MOCK_OWNER}/northwind-site/pull/41`,
  head: { ref: "feat/annual-plan", sha: commitSha("northwind-site", "feat/annual-plan", 3) },
  base: { ref: "main", sha: commitSha("northwind-site", "main") },
  user: { login: "fm-integration-agent[bot]" },
  additions: 48,
  deletions: 6,
  changed_files: 3,
  merge_commit_sha: commitSha("northwind-site", "main", 1),
};
