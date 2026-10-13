/**
 * Door B source catalogue and validation (BUILD §11.1, AC-11.1.5). Pure.
 *
 * The job itself runs on the API (`import.start` / `import.status`: the orchestrator's `importBusiness` workflow when a
 * business and a worker exist, otherwise a deterministic server-side job) and the Scouting report comes back with the
 * finished status; this module keeps the picker's copy (groups, descriptions, consent notes), mirrors the API's
 * input rules so the form can refuse bad values before the round trip, and turns the report into the Ideation brief.
 */
import type { RouterInputs, RouterOutputs } from "@/lib/trpc";

/** `import.status` as the API returns it: the job with per-source steps, the report once done, the workflow handle. */
export type ImportStatus = RouterOutputs["import"]["status"];
export type ImportJob = ImportStatus["job"];
export type SourceProgress = ImportJob["sources"][number];
export type StepStatus = SourceProgress["status"];
export type ScoutingReport = NonNullable<ImportStatus["report"]>;
export type ScoutingDecision = ScoutingReport["firstDecisions"][number];
export type RoadmapSeed = ScoutingReport["roadmapSeeds"][number];
export type ImportStartInput = RouterInputs["import"]["start"];

export type ImportSourceKey = "github" | "google_drive" | "notion" | "linear" | "jira" | "website" | "stripe" | "shopify" | "bank" | "registry";

export type SourceInputKind = "repo" | "url" | "regno" | "none";

export interface ImportSource {
  key: ImportSourceKey;
  label: string;
  group: "Code and documents" | "Work tracking" | "Revenue and money" | "Identity";
  description: string;
  /** Founder-typed value the source needs (repo, URL, registration number) or none (consent flow). */
  input: SourceInputKind;
  placeholder?: string;
  /** Which connector key the gateway will use (BUILD §13). */
  connectorKey: string;
  /** Read-only by design; write is a separate, later consent. */
  readOnly: true;
  /** Shown as the consent note. */
  consent: string;
}

export const IMPORT_SOURCES: readonly ImportSource[] = [
  { key: "github", label: "GitHub", group: "Code and documents", description: "Repo-scoped read through the GitHub App. Clone into the sandbox, read the top 200 files by importance, run tests if present. Never pushes.", input: "repo", placeholder: "owner/repository", connectorKey: "github", readOnly: true, consent: "Read access to one repository. Write is a separate consent later." },
  { key: "google_drive", label: "Google Drive", group: "Code and documents", description: "Decks, plans and spreadsheets in a folder you choose.", input: "none", connectorKey: "google_drive", readOnly: true, consent: "Read access to one folder." },
  { key: "notion", label: "Notion", group: "Work tracking", description: "Wiki pages and databases: specs, roadmaps, meeting notes.", input: "none", connectorKey: "notion", readOnly: true, consent: "Read access to the pages you share." },
  { key: "linear", label: "Linear", group: "Work tracking", description: "Issues, projects and cycles become roadmap seeds.", input: "none", connectorKey: "linear", readOnly: true, consent: "Read access to one workspace." },
  { key: "jira", label: "Jira", group: "Work tracking", description: "Epics and issues become roadmap seeds.", input: "none", connectorKey: "jira", readOnly: true, consent: "Read access to one project." },
  { key: "website", label: "Website", group: "Code and documents", description: "Crawls your public site within robots.txt: positioning, pricing, pages.", input: "url", placeholder: "https://example.com", connectorKey: "web", readOnly: true, consent: "Public pages only; robots.txt is respected." },
  { key: "stripe", label: "Stripe", group: "Revenue and money", description: "Customers, subscriptions, invoices: real revenue history.", input: "none", connectorKey: "stripe", readOnly: true, consent: "Read-only Stripe Connect. Payouts and transfers are never available to agents." },
  { key: "shopify", label: "Shopify", group: "Revenue and money", description: "Orders, products and customers from your store.", input: "none", connectorKey: "shopify", readOnly: true, consent: "Read access to orders, products, customers." },
  { key: "bank", label: "Bank (open banking)", group: "Revenue and money", description: "Balances and transactions for cash and runway. Read only.", input: "none", connectorKey: "tink", readOnly: true, consent: "Account information only; no payment initiation exists." },
  { key: "registry", label: "Company registry", group: "Identity", description: "Legal name, officers, filing deadlines from the public register.", input: "regno", placeholder: "Registration number", connectorKey: "opencorporates", readOnly: true, consent: "Public record lookup." },
];

export const IMPORT_SOURCE_GROUPS = ["Code and documents", "Work tracking", "Revenue and money", "Identity"] as const;

export function sourceByKey(key: string): ImportSource | undefined {
  return IMPORT_SOURCES.find((s) => s.key === key);
}

export interface SourceConfig {
  key: ImportSourceKey;
  value: string;
}

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Null when the typed value is acceptable for the source. */
export function validateSourceValue(source: ImportSource, value: string): string | null {
  const v = value.trim();
  switch (source.input) {
    case "repo":
      if (!v) return "Enter the repository as owner/name.";
      if (!REPO_RE.test(v.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, ""))) return "Use owner/name, for example acme/ledgerly.";
      return null;
    case "url": {
      if (!v) return "Enter the site address.";
      try {
        const u = new URL(v.includes("://") ? v : `https://${v}`);
        if (!/^https?:$/.test(u.protocol) || !u.hostname.includes(".")) return "Use a full address, like https://example.com.";
        return null;
      } catch {
        return "Use a full address, like https://example.com.";
      }
    }
    case "regno":
      if (!v) return "Enter the registration number.";
      if (v.length < 2 || v.length > 40) return "That does not look like a registration number.";
      return null;
    case "none":
      return null;
  }
}

export function normaliseSourceValue(source: ImportSource, value: string): string {
  const v = value.trim();
  if (source.input === "repo") return v.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
  if (source.input === "url") return v.includes("://") ? v : `https://${v}`;
  return v;
}

export function validateConfigs(configs: readonly SourceConfig[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const c of configs) {
    const s = sourceByKey(c.key);
    if (!s) continue;
    const err = validateSourceValue(s, c.value);
    if (err) errors[c.key] = err;
  }
  return errors;
}

/* ---------- job progress (pure over the API's shape) ---------- */

export function totalSteps(job: ImportJob): number {
  return job.sources.reduce((n, s) => n + s.steps.length, 0);
}

export function doneSteps(job: ImportJob): number {
  return job.sources.reduce((n, s) => n + s.steps.filter((st) => st.status === "done").length, 0);
}
