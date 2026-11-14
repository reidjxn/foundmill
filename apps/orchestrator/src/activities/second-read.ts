/**
 * The second read (packages/agents second-read.ts): the agent that checks is never the agent that wrote it.
 *
 * - `secondReadMerge` (mergeReview, before the merge is asked for): a different agent (the Review agent when the team
 *   has one, else the Chief of Staff) reviews the branch's diff on the `codeReview` route. The diff is read through the
 *   gateway on a read-only token (`compare_refs` and `read_file`, each at most `SECOND_READ_LIMITS`), and the review is
 *   stored on record (`merge.reviewed`, against the task and the branch head), which the Inbox shows with the founder's
 *   approval (apps/api `approvalWhatFor`). It never blocks the founder's decision, never merges, and a head it already
 *   reviewed is not reviewed again.
 * - `secondReadDocument` (businessFoundations, once the drafts are written): a different agent from the author reads the
 *   vision, specification and roadmap the agents drafted (or the specification, the roadmap or the Policies section on
 *   their own) in at most two rounds, looks claims that need a source up on the web through the gateway where the `web`
 *   connector answers, and stores the issues on record against the document (`second_read.completed`). The founder gets
 *   them in one Inbox note from the second reader, and the author one planned revision task (`SECOND_READ_REVISIONS`).
 *   A simulated web result is never a checked fact; a review in practice mode says so.
 *
 * Both are best effort: a failure is logged and the work goes on as if there were no second read.
 */
import {
  boundedDiff,
  buildCodeSecondReadRequest,
  docText,
  finaliseCodeSecondRead,
  getTemplateByAgentType,
  isLongDocument,
  narrowToRevision,
  pickSecondReader,
  runSecondRead,
  SECOND_READ_LIMITS,
  secondReadKindWords,
  secondReadNote,
  secondReadRevisionGoal,
  type DiffFile,
  type FactChecker,
  type SecondReadDocument,
  type SecondReadDocumentKind,
  type SecondReadSection,
  type SecondReadSource,
} from "@foundmill/agents";
import { isUntrusted } from "@foundmill/connectors";
import { repos } from "@foundmill/db";
import type { OrchestratorDeps } from "../deps";
import { postNote } from "./dispatch";
import { resultOf } from "./merge";
import type { MergeInput, MergePullRequest } from "./types";

/** Audit actions of the second read. */
export const SECOND_READ_AUDIT = { merge: "merge.reviewed", document: "second_read.completed" } as const;
/** The diff is read on a token that can only read (the gateway answers it as data). */
const DIFF_READ_TOOLS = ["github:compare_refs", "github:read_file"];
const WEB_READ_TOOLS = ["web:search_web", "web:fetch_page"];
const TOKEN_TTL_SECONDS = 300;
const CALL_TIMEOUT_MS = 60_000;
const HISTORY = 200;

export type MergeSecondRead =
  /** `headSha`: the commit the review read, which the merge names in its arguments (null when GitHub gave none). */
  | { status: "reviewed"; cached: boolean; verdict: string; findings: number; reviewerAgentId: string; headSha: string | null }
  | { status: "skipped"; reason: string };

export type DocumentSecondRead =
  | { status: "reviewed"; issues: number; reviewerAgentId: string; inboxItem: boolean; revisionTaskId: string | null }
  | { status: "skipped"; reason: string };

export interface DocumentSecondReadInput {
  businessId: string;
  kind: SecondReadDocumentKind;
  /** Ties the read to one draft (the foundations attempt); a second call for the same one does nothing. */
  version: string;
}

/** A tool call's result was simulated (the gateway's mock connectors, or the offline gateway). */
const isSimulated = (res: { result?: unknown }): boolean => {
  const r = res.result as { simulated?: unknown; mock?: unknown } | undefined;
  return r?.simulated === true || r?.mock === true;
};

interface CompareOut {
  mergeBaseSha?: unknown;
  headSha?: unknown;
  files?: unknown;
}

export function createSecondReadActivities(deps: OrchestratorDeps) {
  const { db } = deps;
  const roster = async (businessId: string) => (await repos.agents.list(db, businessId, { limit: 200 })).items;

  return {
    /** The diff of a task's branch, reviewed by a different agent before the founder is asked; on record, never blocking. */
    async secondReadMerge(input: MergeInput & MergePullRequest): Promise<MergeSecondRead> {
      try {
        const target = await repos.integrations.codeRepository(db, input.businessId);
        if (!target) return { status: "skipped", reason: "no repository is chosen on the Code tab" };
        const reviewer = pickSecondReader(await roster(input.businessId), input.agentId);
        if (!reviewer) return { status: "skipped", reason: "no other agent on the team to read it" };
        const repo = { owner: target.owner, repo: target.repo };
        // In the reviewer's name, outside any session: the reads are the reviewer's, never on the author's session.
        const { token } = await deps.gateway.mintSessionToken({ businessId: input.businessId, agentId: reviewer.id, sessionId: null, allowedTools: DIFF_READ_TOOLS, ttlSeconds: TOKEN_TTL_SECONDS });
        let simulated = false;
        const call = async <T>(tool: string, args: Record<string, unknown>) => {
          const res = await deps.gateway.call(token, { connector: "github", tool, args }, { timeoutMs: CALL_TIMEOUT_MS });
          simulated ||= isSimulated(res);
          return resultOf<T>(res);
        };
        const compared = await call<CompareOut>("compare_refs", { ...repo, base: "HEAD", head: input.branch });
        if (!compared.ok || !Array.isArray(compared.data.files)) return { status: "skipped", reason: `the change could not be read: ${compared.ok ? "no files" : compared.message}`.slice(0, 300) };
        const headSha = typeof compared.data.headSha === "string" ? compared.data.headSha : null;
        const baseSha = typeof compared.data.mergeBaseSha === "string" ? compared.data.mergeBaseSha : "HEAD";

        // A head already reviewed is not reviewed again (the cycle's sweep runs the merge review again and again).
        const earlier = (await repos.audit.list(db, input.businessId, { action: SECOND_READ_AUDIT.merge, limit: HISTORY })).items.find((a) => (a.target as { id?: unknown } | null)?.id === input.taskId && (a.details as { prNumber?: unknown; headSha?: unknown } | null)?.prNumber === input.prNumber && headSha !== null && (a.details as { headSha?: unknown }).headSha === headSha);
        if (earlier) {
          const d = earlier.details as { verdict?: string; findings?: unknown[]; reviewerAgentId?: string };
          return { status: "reviewed", cached: true, verdict: d.verdict ?? "comment", findings: Array.isArray(d.findings) ? d.findings.length : 0, reviewerAgentId: d.reviewerAgentId ?? reviewer.id, headSha };
        }

        // The changed files, before and after, within the limits (two reads per file at most). Every file left out (past
        // the limit, binary, unreadable) counts: the approval says how much of the change was read.
        const all = (compared.data.files as { path?: unknown; status?: unknown }[]).filter((f) => typeof f?.path === "string");
        const changed = all.slice(0, SECOND_READ_LIMITS.maxDiffFiles);
        const read = async (path: string, ref: string): Promise<string | null> => {
          const r = await call<{ content?: unknown; encoding?: unknown }>("read_file", { ...repo, path, ref });
          return r.ok && typeof r.data.content === "string" && r.data.encoding !== "base64" ? r.data.content : null;
        };
        const files: DiffFile[] = [];
        for (const f of changed) {
          const path = f.path as string;
          const status = String(f.status ?? "modified");
          // Before: the commit the branch left from (the default branch when that commit cannot be read). After: the head
          // commit the compare saw, so the review is of one exact version (the merge names it).
          const before = status === "added" ? null : ((await read(path, baseSha)) ?? (baseSha !== "HEAD" ? await read(path, "HEAD") : null));
          const after = status === "removed" ? null : await read(path, headSha ?? input.branch);
          // A side that could not be read (binary, too large, gone) leaves the file out, and it counts as not read.
          if ((status !== "removed" && after === null) || (status !== "added" && before === null)) continue;
          files.push({ path, status, before, after });
        }
        const bounded = boundedDiff(files);
        if (!bounded.diff) return { status: "skipped", reason: "the change has no text the reviewer can read" };
        const truncated = bounded.truncated || bounded.files.length < all.length;

        const [task, business] = await Promise.all([repos.tasks.get(db, input.businessId, input.taskId), repos.businesses.get(db, input.businessId)]);
        const req = buildCodeSecondReadRequest({
          businessName: business.name,
          taskGoal: task.goalMd || task.title,
          acceptanceCriteria: (task.acceptance ?? []).filter((c): c is string => typeof c === "string"),
          testResults: input.acceptance ? `${input.acceptance.passing} of ${input.acceptance.total} acceptance tests passed in the platform's sandbox.` : "No tests the sandbox could run.",
          diff: bounded.diff,
          truncated,
        });
        const res = await deps.models.complete({ ...req, scope: `second-read:${input.taskId}`, attribution: { businessId: input.businessId, agentId: reviewer.id, taskId: input.taskId, kind: "second_read" } });
        const review = finaliseCodeSecondRead(res.json, bounded.files);
        await repos.audit.append(db, input.businessId, {
          actorKind: "agent",
          actorId: reviewer.id,
          action: SECOND_READ_AUDIT.merge,
          target: { kind: "task", id: input.taskId },
          details: {
            prNumber: input.prNumber,
            prUrl: input.prUrl,
            headSha,
            reviewerAgentId: reviewer.id,
            reviewerName: reviewer.name,
            authorAgentId: input.agentId,
            verdict: review.verdict,
            summary: review.summary,
            findings: review.findings,
            filesReviewed: bounded.files,
            filesTotal: all.length,
            truncated,
            // A review in practice mode is sample output, and a diff read from the mock repository is sample data.
            simulated: simulated || res.mode === "mock",
            model: { route: res.route, mode: res.mode, costMinor: res.cost.costMinorInt, costLabel: "Estimate" },
          },
        });
        return { status: "reviewed", cached: false, verdict: review.verdict, findings: review.findings.length, reviewerAgentId: reviewer.id, headSha };
      } catch (err) {
        deps.log.warn({ businessId: input.businessId, taskId: input.taskId, err: (err as Error).message }, "second read: the change could not be reviewed");
        return { status: "skipped", reason: "the review could not run this time" };
      }
    },

    /** A long document an agent drafted, read by a different agent; the issues go to the founder and the author. */
    async secondReadDocument(input: DocumentSecondReadInput): Promise<DocumentSecondRead> {
      try {
        const targetId = `${input.kind}:${input.version}`;
        const done = (await repos.audit.list(db, input.businessId, { action: SECOND_READ_AUDIT.document, limit: HISTORY })).items.some((a) => (a.target as { id?: unknown } | null)?.id === targetId);
        if (done) return { status: "skipped", reason: "this draft already had its second read" };
        const document = await loadDocument(deps, input);
        if (!document) return { status: "skipped", reason: "the agents drafted nothing of it" };
        if (!isLongDocument(document)) return { status: "skipped", reason: "it is too short to need a second read" };
        const agents = await roster(input.businessId);
        const reviewer = pickSecondReader(agents, document.authorAgentId);
        if (!reviewer) return { status: "skipped", reason: "no other agent on the team to read it" };
        const business = await repos.businesses.get(db, input.businessId);

        const result = await runSecondRead({
          models: deps.models,
          businessName: business.name,
          document,
          reviewer,
          factCheck: webFactChecker(deps, input.businessId, reviewer.id),
          attribution: { businessId: input.businessId, agentId: reviewer.id, kind: "second_read" },
          scope: `second-read:${input.businessId}`,
        });
        const simulated = result.usage.mode === "mock" || result.factCheck === "simulated_only";

        // The author's one revision, as planned work its own department picks up (never more than one per draft).
        const author = document.authorAgentId ? (agents.find((a) => a.id === document.authorAgentId) ?? null) : null;
        let revisionTaskId: string | null = null;
        if (author && result.issues.length > 0) {
          const kind = getTemplateByAgentType(author.agentType)?.taskKinds[0] ?? "ops";
          const task = await repos.tasks.create(db, input.businessId, {
            kind,
            title: `Revise the ${secondReadKindWords(document.kind)} after its second read`.slice(0, 200),
            goalMd: secondReadRevisionGoal(result),
            acceptance: ["Each issue from the second read is fixed or answered in the report.", "Nothing pinned or written by the founder is changed.", "Only one revision is made."],
            assigneeAgentId: author.id,
            status: "planned",
          });
          revisionTaskId = task.id;
        }
        await repos.audit.append(db, input.businessId, {
          actorKind: "agent",
          actorId: reviewer.id,
          action: SECOND_READ_AUDIT.document,
          target: { kind: "document", id: targetId },
          details: {
            document: result.document,
            reviewerAgentId: reviewer.id,
            reviewerName: reviewer.name,
            authorAgentId: result.authorAgentId,
            rounds: result.rounds,
            summary: result.summary,
            issues: result.issues,
            factCheck: result.factCheck,
            truncated: result.truncated,
            revisionsAllowed: result.revisionsAllowed,
            revisionTaskId,
            simulated,
            model: { route: "documentReview", mode: result.usage.mode, calls: result.usage.calls, costMinor: result.usage.costMinor, costLabel: "Estimate" },
          },
        });
        let inboxItem = false;
        if (result.issues.length > 0) {
          const note = secondReadNote(result, author?.name ?? document.authorName);
          const practice = result.usage.mode === "mock" ? "\nThis read ran in practice mode: it is a sample of what a second read finds, not a real check." : "";
          await postNote(deps, input.businessId, reviewer.id, { type: "update", subject: note.subject, body: `${note.bodyMd}${practice}`, blocksContinue: false });
          inboxItem = true;
        }
        return { status: "reviewed", issues: result.issues.length, reviewerAgentId: reviewer.id, inboxItem, revisionTaskId };
      } catch (err) {
        deps.log.warn({ businessId: input.businessId, kind: input.kind, err: (err as Error).message }, "second read: the document could not be read");
        return { status: "skipped", reason: "the second read could not run this time" };
      }
    },
  };
}

export type SecondReadActivities = ReturnType<typeof createSecondReadActivities>;

/** A second read's revision task: its id is on record in the read's `second_read.completed` row (append-only). */
export async function isSecondReadRevision(db: OrchestratorDeps["db"], businessId: string, taskId: string): Promise<boolean> {
  const rows = (await repos.audit.list(db, businessId, { action: SECOND_READ_AUDIT.document, limit: HISTORY })).items;
  return rows.some((a) => (a.details as { revisionTaskId?: unknown } | null)?.revisionTaskId === taskId);
}

/**
 * The grants a task's session runs with: a second read's revision keeps only the document tools
 * (`SECOND_READ_REVISION_TOOLS`), whatever its author may do elsewhere, so the reviewer's notes can never become an
 * outward action. Any other task keeps its agent's grants.
 */
export async function sessionGrantsFor<G extends { toolRefs: string[]; servers: string[]; mcpTools: string[]; builtinTools: string[] }>(db: OrchestratorDeps["db"], businessId: string, taskId: string, grants: G): Promise<G> {
  return (await isSecondReadRevision(db, businessId, taskId)) ? narrowToRevision(grants) : grants;
}

/** The document as the agents drafted it: only what an agent wrote (the founder's own words and pinned blocks are theirs). */
async function loadDocument(deps: OrchestratorDeps, input: DocumentSecondReadInput): Promise<SecondReadDocument | null> {
  const { db } = deps;
  const sections: SecondReadSection[] = [];
  const authors = new Map<string, number>();
  const wantSpec = input.kind === "foundations" || input.kind === "specification" || input.kind === "policy" || input.kind === "pitch";
  const wantRoadmap = input.kind === "foundations" || input.kind === "roadmap";
  let foundationsAuthor: string | null = null;

  if (input.kind === "foundations") {
    const [row, inputs] = await Promise.all([repos.foundations.get(db, input.businessId), repos.foundations.inputs(db, input.businessId)]);
    foundationsAuthor = inputs.authorAgentId;
    const v = (row?.vision ?? null) as { statement?: unknown; forWhom?: unknown; problem?: unknown; whyNow?: unknown; northStar?: { metric?: unknown; target?: unknown; label?: unknown } } | null;
    if (v) {
      const north = v.northStar && typeof v.northStar.metric === "string" ? `North star: ${v.northStar.metric}${typeof v.northStar.target === "string" && v.northStar.target ? `, ${v.northStar.target}` : ""}${typeof v.northStar.label === "string" ? ` (${v.northStar.label})` : ""}.` : "";
      const text = [v.statement, v.forWhom, v.problem, v.whyNow].filter((x): x is string => typeof x === "string" && x.trim().length > 0).join("\n");
      if (text || north) sections.push({ id: "vision", heading: "Vision", text: [text, north].filter(Boolean).join("\n") });
    }
  }
  if (wantSpec) {
    const blocks = await repos.product.listBlocks(db, input.businessId, input.kind === "policy" ? { section: "Policies" } : {});
    for (const b of blocks) {
      if (b.authoredByKind !== "agent" || b.pinned || b.archivedAt) continue;
      const text = docText(b.content);
      if (!text.trim()) continue;
      sections.push({ id: b.id, heading: b.section, text });
      if (b.authoredBy) authors.set(b.authoredBy, (authors.get(b.authoredBy) ?? 0) + 1);
    }
  }
  if (wantRoadmap) {
    const items = await repos.product.listRoadmap(db, input.businessId);
    const text = items
      .filter((i) => !i.archivedAt)
      .map((i) => `${i.title} (${i.horizon}). ${i.descriptionMd.replace(/\s+/g, " ").trim()}`.trim())
      .join("\n");
    if (text.trim()) sections.push({ id: "roadmap", heading: "Roadmap", text });
  }
  if (sections.length === 0) return null;
  const authorAgentId = foundationsAuthor ?? [...authors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const author = authorAgentId ? await repos.agents.get(db, input.businessId, authorAgentId).catch(() => null) : null;
  return { kind: input.kind, id: `${input.kind}:${input.version}`, title: `The ${secondReadKindWords(input.kind)}`, authorAgentId, authorName: author?.name ?? "the team", sections };
}

/**
 * Claims looked up on the web through the gateway, in the reviewer's name, on a token that can only search and read
 * pages: one search per claim, the top result read. Every result stays the untrusted envelope's content (it reaches the
 * reviewer only inside an <untrusted_content> block) and carries whether the gateway simulated it. A refusal (the
 * reviewer has no web grant, the connector is off) makes the check unavailable, never a guess.
 */
function webFactChecker(deps: OrchestratorDeps, businessId: string, reviewerId: string): FactChecker {
  return async (claims) => {
    const { token } = await deps.gateway.mintSessionToken({ businessId, agentId: reviewerId, sessionId: null, allowedTools: WEB_READ_TOOLS, ttlSeconds: TOKEN_TTL_SECONDS });
    const sources: SecondReadSource[] = [];
    for (const claim of claims) {
      const searched = await deps.gateway.call(token, { connector: "web", tool: "search_web", args: { query: claim.quote.slice(0, 300), limit: 2 } }, { timeoutMs: CALL_TIMEOUT_MS });
      if (searched.outcome !== "allow") throw new Error(`web search not available: ${searched.outcome}`);
      const found = resultOf<{ results?: { url?: unknown; title?: unknown }[] }>(searched);
      const top = found.ok && Array.isArray(found.data.results) ? found.data.results.find((r) => typeof r?.url === "string") : undefined;
      if (!top) continue;
      const url = String(top.url).slice(0, 500);
      const page = await deps.gateway.call(token, { connector: "web", tool: "fetch_page", args: { url, maxChars: SECOND_READ_LIMITS.maxSourceChars } }, { timeoutMs: CALL_TIMEOUT_MS });
      const read = resultOf<unknown>(page);
      // The agent envelope (`untrusted`, `content`, `notice`): only its content is the page, and it stays untrusted.
      const data = read.ok ? read.data : null;
      const content = isUntrusted(data) ? data.content : data && typeof data === "object" && (data as { untrusted?: unknown }).untrusted === true ? (data as { content?: unknown }).content : data;
      sources.push({ id: `w${sources.length + 1}`, claimId: claim.id, simulated: isSimulated(searched) || isSimulated(page), url: /^https?:\/\//.test(url) ? url : null, title: typeof top.title === "string" ? top.title.slice(0, 200) : null, content: content ?? null });
    }
    return sources;
  };
}
