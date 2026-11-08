/**
 * 0030 approvals the founder decides in the Inbox (audit FR-01 / O-02 / O-26): an approval knows its task and amount,
 * opens one decision item that blocks Continue, one gated call has one approval (`claimOpen`), a granted approval is
 * used once by the same call (`useGranted`), and a task waits while its approval is open or was just rejected (`holds`).
 */
import { founderJargonHits } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { APPROVAL_OPTIONS, founderReasons, approvalArgsText, approvalItem, approvalOutcomeOf, approvalSection, closeApprovalItem, isApprovalOption, openApprovalItem } from "../../approvals";
import { repos } from "../../repos";
import { setupRepoHarness, type RepoHarness } from "./helpers";

let r: RepoHarness;
beforeAll(async () => {
  r = await setupRepoHarness("apprinbox");
});
afterAll(() => r?.close());

const call = { connectorKey: "github", tool: "run_migration", args: { file: "0019_idx.sql", concurrently: true } };

async function newTask(title: string) {
  return repos.tasks.create(r.db, r.A.businessId, { kind: "code", title, goalMd: title, assigneeAgentId: r.A.agentId, status: "running" });
}

async function newSession(taskId: string, startedAt = new Date()) {
  return repos.agents.createSession(r.db, r.A.businessId, { agentId: r.A.agentId, taskId, modelKey: "sonnet", startedAt });
}

describe("approval rows (0030)", () => {
  it("take the task of the session that asked, and refuse a task of another business", async () => {
    const task = await newTask("Add the usage index");
    const session = await newSession(task.id);
    const a = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: session.id, ...call, amountMinor: 12_000, currency: "gbp" });
    expect(a.taskId).toBe(task.id);
    expect(a.amountMinor).toBe(12_000);
    expect(a.currency).toBe("GBP");
    await expect(repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, taskId: r.B.taskId, ...call })).rejects.toThrow(/not a task of this business/);
    expect((await repos.approvals.find(r.db, r.B.businessId, a.id))).toBeNull();
  });
});

describe("the decision item", () => {
  it("names the agent, the task, the call and the amount, offers Approve and Reject, and blocks Continue, once", async () => {
    const task = await newTask("Set up the first runway forecast");
    const session = await newSession(task.id);
    const approval = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: session.id, connectorKey: "stripe", tool: "create_coupon", args: { code: "ANNUAL20" }, reasons: ["spend above the approval threshold"], amountMinor: 4_500, currency: "USD" });
    const event = await repos.events.write(r.db, r.A.businessId, { type: "approval.requested", actor: { kind: "agent", id: r.A.agentId }, payload: { approvalId: approval.id } });

    const opened = await openApprovalItem(r.db, r.A.businessId, approval, { agentId: r.A.agentId, agentName: "Finance Lead", argsSummary: "ANNUAL20: 20% off annual plans", sourceEventIds: [event.id] });
    expect(opened.created).toBe(true);
    const item = opened.item;
    expect(item.type).toBe("decision");
    // A question waits in Needs you without holding Continue (0071, Nov 7, 2026).
    expect(item.blocksContinue).toBe(false);
    expect(item.fromAgentId).toBe(r.A.agentId);
    expect(item.subject).toBe("Finance Lead needs your OK: Stripe › create coupon");
    expect(item.bodyMd).toContain("“Set up the first runway forecast”");
    expect(item.bodyMd).toContain("$45.00");
    // Two sentences in the founder's words (Nov 3, 2026: what happened, the question); what yes and no do sit on the
    // options, why the founder is asked is the reading pane's own row, and the arguments stay in its Details.
    // The body names the agent as markup with its stored name, never a display choice (One name everywhere, Nov 8, 2026);
    // the subject stays plain and the web names it under the reader's preference.
    expect(item.bodyMd).toBe(`[[ent:${r.A.agentId}|Finance Lead]] wants to create coupon on Stripe for “Set up the first runway forecast”, spending **$45.00**. OK?`);
    expect(item.bodyMd).not.toContain("ANNUAL20");
    const options = (item.decision as { options: { id: string; label: string }[] }).options;
    expect(options.map((o) => [o.id, o.label])).toEqual([
      [APPROVAL_OPTIONS.approve, "Approve"],
      [APPROVAL_OPTIONS.reject, "Reject"],
    ]);
    const linked = await repos.approvals.get(r.db, r.A.businessId, approval.id);
    expect(linked.inboxItemId).toBe(item.id);
    expect((await repos.approvals.forInboxItem(r.db, r.A.businessId, item.id))?.id).toBe(approval.id);
    const narrated = await repos.events.get(r.db, r.A.businessId, event.id);
    expect(narrated.narrated).toBe(true);

    const again = await openApprovalItem(r.db, r.A.businessId, linked, { agentId: r.A.agentId, agentName: "Finance Lead" });
    expect(again).toMatchObject({ created: false, item: { id: item.id } });
  });

  it("is closed as the founder's answer when decided elsewhere, and archived when the approval expired", async () => {
    const a = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, ...call });
    const { item } = await openApprovalItem(r.db, r.A.businessId, a, { agentId: r.A.agentId, agentName: "Legal Lead" });
    const resolved = await repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "rejected", byKind: "user", byId: r.A.ownerId });
    const closed = await closeApprovalItem(r.db, r.A.businessId, resolved);
    expect(closed).toMatchObject({ id: item.id, state: "answered", blocksContinue: false });
    expect((await repos.inbox.decisionsFor(r.db, r.A.businessId, item.id)).map((d) => d.chosenOption)).toEqual([APPROVAL_OPTIONS.reject]);
    expect(await closeApprovalItem(r.db, r.A.businessId, resolved)).toBeNull();

    const b = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, ...call });
    const second = await openApprovalItem(r.db, r.A.businessId, b, { agentId: r.A.agentId, agentName: "Legal Lead" });
    const expired = await repos.approvals.resolve(r.db, r.A.businessId, b.id, { outcome: "expired", byKind: "system" });
    expect(await closeApprovalItem(r.db, r.A.businessId, expired)).toMatchObject({ id: second.item.id, state: "archived" });
  });

  it("shows a push's file paths and leaves their contents out, however large the call is", () => {
    // `github.commit_files` carries every changed file as base64: up to 10 MB that must not travel with the note.
    const files = Array.from({ length: 40 }, (_, i) => ({ path: `src/module-${i}.ts`, content: "QUJD".repeat(50_000), encoding: "base64" }));
    const push = { args: { owner: "acme", repo: "ledger", branch: "agent/usage-index", message: "Add the usage index", files } };
    const text = approvalArgsText(push);
    expect(text.length).toBeLessThanOrEqual(1_200);
    expect(text).toContain("agent/usage-index");
    expect(text).toContain("src/module-0.ts");
    expect(text).not.toContain("QUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJDQUJD".repeat(5));
    const item = approvalItem({ connectorKey: "github", tool: "commit_files", reasons: [], amountMinor: null, currency: null, ...push }, { agentId: r.A.agentId, agentName: "Engineer" });
    expect(item.body_md.length).toBeLessThan(2_000);
    // The agent's own summary and short arguments are shown as they are.
    expect(approvalArgsText({ args: { code: "ANNUAL20" } })).toBe('{"code":"ANNUAL20"}');
    expect(approvalArgsText({ args: { summary: "create index" } })).toBe("create index");
  });

  it("maps options to outcomes and calls to sections", () => {
    expect(approvalOutcomeOf(APPROVAL_OPTIONS.approve)).toBe("approved");
    expect(approvalOutcomeOf(APPROVAL_OPTIONS.reject)).toBe("rejected");
    expect(approvalOutcomeOf("approve")).toBeNull();
    expect(isApprovalOption("reject_request")).toBe(true);
    expect(approvalSection({ connectorKey: "stripe", tool: "create_coupon" })).toBe("finance");
    expect(approvalSection({ connectorKey: "github", tool: "run_migration" })).toBe("development");
    expect(approvalSection({ connectorKey: "platform", tool: "launch_campaign" })).toBe("distribution");
    expect(approvalSection({ connectorKey: "notion", tool: "create_page" })).toBeNull();
    // No amount: no money in the note.
    const plain = approvalItem({ connectorKey: "github", tool: "run_migration", reasons: [], amountMinor: null, currency: null, args: { summary: "create index" } }, { agentId: r.A.agentId, agentName: "Legal Lead" });
    expect(plain.body_md).not.toMatch(/spending|committing/);
    // The arguments never reach the note (the reading pane's Details hold them).
    expect(plain.body_md).not.toContain("create index");
    // The tool's words in the founder's (the shared map): "run migration" reads "run a change to the data layout".
    expect(plain.body_md).toBe(`[[ent:${r.A.agentId}|Legal Lead]] wants to run a change to the data layout on GitHub. OK?`);
    expect(plain.blocks_continue).toBe(true);
    // A release is worded as the moment it is for the founder, with the platform's test counts.
    const release = approvalItem({ connectorKey: "github", tool: "merge_pr", reasons: ["You chose to be asked before anything goes live"], amountMinor: null, currency: null, args: { owner: "acme", repo: "shop", prNumber: 38, mergeMethod: "squash" } }, { agentId: r.A.agentId, agentName: "Eva", taskTitle: "Assert no hydration errors in the example-business Playwright spec", tests: { passing: 144, total: 144 } });
    expect(release.subject).toBe("Eva's change is ready to go live");
    // The founder-language boundary (2026-11-01): nothing a founder reads in the note names the engineering vocabulary;
    // the task's own title is quoted as given (the founder title once the Composer has written one).
    const released = `${release.subject}. ${release.body_md.replace(/“[^”]*”/g, "")}. ${(release.decision?.options ?? []).map((o) => `${o.label}. ${o.consequence}`).join(" ")}`;
    expect(founderJargonHits(released).map((h) => h.term), released).toEqual([]);
    expect(founderJargonHits(`${plain.subject}. ${plain.body_md}`).map((h) => h.term)).toEqual([]);
    expect(release.body_md).toBe(`[[ent:${r.A.agentId}|Eva]] finished “Assert no hydration errors in the example-business Playwright spec”. It passed every quality check. OK to put it live?`);
    expect(release.body_md).not.toMatch(/prNumber|squash|merge|#38|\{/);
    // A release never holds Continue: the merge waits for the answer in the background.
    expect(release.blocks_continue).toBe(false);
    expect((release.decision.options as { label: string; consequence: string }[]).map((o) => o.label)).toEqual(["Put it live", "Not now"]);
    expect((release.decision.options as { consequence: string }[])[0]!.consequence).toBe("It goes live once the final quality checks pass; if one fails, Eva fixes it and asks again.");
    expect(approvalItem({ connectorKey: "github", tool: "merge_pr", reasons: [], amountMinor: null, currency: null, args: {} }, { agentId: r.A.agentId, agentName: "Eva", tests: null }).body_md).toBe(`[[ent:${r.A.agentId}|Eva]] finished a change. There was nothing in it to check. OK to put it live?`);
    expect(approvalItem({ connectorKey: "github", tool: "merge_pr", reasons: [], amountMinor: null, currency: null, args: {} }, { agentId: r.A.agentId, agentName: "Eva", taskTitle: "Fix the sign-in page", tests: { passing: 19, total: 25 } }).body_md).toBe(`[[ent:${r.A.agentId}|Eva]] finished “Fix the sign-in page”. It passed most of its quality checks. OK to put it live?`);
    expect(founderReasons(["Assisted mode: irreversible actions need approval", "spend above the approval threshold", "something this table does not know"])).toEqual(["You chose to be asked before anything that can't be undone.", "This would spend more than you allowed without asking."]);
  });
});

describe("one approval per gated call", () => {
  it("a call that asks again waits on the open approval, handed to the session asking now", async () => {
    const task = await newTask("Jurisdiction and compliance scan");
    const first = await newSession(task.id);
    const open = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: first.id, ...call });
    // Same session, same call, keys in another order: the same approval.
    expect((await repos.approvals.claimOpen(r.db, r.A.businessId, { sessionId: first.id, agentId: r.A.agentId, connectorKey: "github", tool: "run_migration", args: { concurrently: true, file: "0019_idx.sql" } }))?.id).toBe(open.id);
    // Other arguments are another call, and so is another amount.
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, { sessionId: first.id, agentId: r.A.agentId, connectorKey: "github", tool: "run_migration", args: { file: "0020.sql" } })).toBeNull();
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, { sessionId: first.id, agentId: r.A.agentId, ...call, amountMinor: 1_000, currency: "USD" })).toBeNull();
    // A later session on the task takes the open approval over: the decision goes to it.
    const second = await newSession(task.id);
    const claimed = await repos.approvals.claimOpen(r.db, r.A.businessId, { sessionId: second.id, agentId: r.A.agentId, ...call });
    expect(claimed).toMatchObject({ id: open.id, sessionId: second.id, taskId: task.id });
    // Another agent's call never shares it, nor does another business.
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, { sessionId: second.id, agentId: r.A.agent2Id, ...call })).toBeNull();
    expect(await repos.approvals.claimOpen(r.db, r.B.businessId, { sessionId: second.id, agentId: r.A.agentId, ...call })).toBeNull();
    // Decided: nothing open to claim.
    await repos.approvals.resolve(r.db, r.A.businessId, open.id, { outcome: "rejected", byId: r.A.ownerId });
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, { sessionId: second.id, agentId: r.A.agentId, ...call })).toBeNull();
  });

  it("a spend waits on the open request for exactly its amount and currency", async () => {
    const task = await newTask("Raise the search budget");
    const session = await newSession(task.id);
    const spend = { connectorKey: "stripe", tool: "create_coupon", args: { code: "SPRING" } };
    const open = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: session.id, ...spend, amountMinor: 5_000, currency: "GBP" });
    const ask = { sessionId: session.id, agentId: r.A.agentId, ...spend };
    expect((await repos.approvals.claimOpen(r.db, r.A.businessId, { ...ask, amountMinor: 5_000, currency: "gbp" }))?.id).toBe(open.id);
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, { ...ask, amountMinor: 5_000, currency: "EUR" })).toBeNull();
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, { ...ask, amountMinor: 4_000, currency: "GBP" })).toBeNull();
    expect(await repos.approvals.claimOpen(r.db, r.A.businessId, ask)).toBeNull();
  });

  it("a granted approval is used once, by the same call on the same task, within its amount and currency", async () => {
    const task = await newTask("Launch the annual discount");
    const first = await newSession(task.id);
    const a = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: first.id, connectorKey: "stripe", tool: "create_coupon", args: { code: "ANNUAL20" }, amountMinor: 5_000, currency: "USD" });
    const ask = { agentId: r.A.agentId, connectorKey: "stripe", tool: "create_coupon", args: { code: "ANNUAL20" }, currency: "usd" };
    expect(await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: first.id, ...ask, amountMinor: 5_000 })).toBeNull(); // still open
    await repos.approvals.resolve(r.db, r.A.businessId, a.id, { outcome: "approved", byKind: "user", byId: r.A.ownerId });
    // The next session on the task (the first ended before the answer) finds it granted.
    const next = await newSession(task.id);
    expect(await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, amountMinor: 6_000 })).toBeNull(); // more than asked
    expect(await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, args: { code: "ANNUAL50" }, amountMinor: 5_000 })).toBeNull(); // another call
    expect(await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, amountMinor: 5_000, currency: "JPY" })).toBeNull(); // another currency
    expect(await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, amountMinor: 5_000, currency: null })).toBeNull(); // a spend in no currency
    const used = await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, amountMinor: 5_000 });
    expect(used).toMatchObject({ id: a.id, usedBySessionId: next.id });
    expect(used?.usedAt).toBeInstanceOf(Date);
    // Once only.
    expect(await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, amountMinor: 5_000 })).toBeNull();
    // Given back by the session that used it (the vendor refused the call), it can be used again; by anyone else, never.
    expect(await repos.approvals.releaseUse(r.db, r.A.businessId, a.id, first.id)).toBe(false);
    expect(await repos.approvals.releaseUse(r.db, r.B.businessId, a.id, next.id)).toBe(false);
    expect(await repos.approvals.releaseUse(r.db, r.A.businessId, a.id, next.id)).toBe(true);
    expect(await repos.approvals.releaseUse(r.db, r.A.businessId, a.id, next.id)).toBe(false);
    expect((await repos.approvals.useGranted(r.db, r.A.businessId, { sessionId: next.id, ...ask, amountMinor: 5_000 }))?.id).toBe(a.id);
  });
});

describe("tasks waiting on the founder", () => {
  it("hold while the approval is open or was rejected since the last session, never once approved", async () => {
    const t1 = await newTask("Open approval");
    const t2 = await newTask("Approved");
    const t3 = await newTask("Rejected");
    const t4 = await newTask("Rejected, started again");
    const t5 = await newTask("Never asked");
    const s1 = await newSession(t1.id, new Date(Date.now() - 60_000));
    const s2 = await newSession(t2.id, new Date(Date.now() - 60_000));
    const s3 = await newSession(t3.id, new Date(Date.now() - 60_000));
    const s4 = await newSession(t4.id, new Date(Date.now() - 60_000));
    const a1 = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: s1.id, ...call });
    const a2 = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: s2.id, ...call });
    const a3 = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: s3.id, ...call });
    const a4 = await repos.approvals.create(r.db, r.A.businessId, { agentId: r.A.agentId, sessionId: s4.id, ...call });
    await repos.approvals.resolve(r.db, r.A.businessId, a2.id, { outcome: "approved", byId: r.A.ownerId });
    await repos.approvals.resolve(r.db, r.A.businessId, a3.id, { outcome: "rejected", byId: r.A.ownerId });
    await repos.approvals.resolve(r.db, r.A.businessId, a4.id, { outcome: "rejected", byId: r.A.ownerId });
    await newSession(t4.id, new Date(Date.now() + 1_000)); // started by hand after the rejection

    const holds = await repos.approvals.holds(r.db, r.A.businessId, [t1.id, t2.id, t3.id, t4.id, t5.id]);
    expect(holds.get(t1.id)).toEqual({ approvalId: a1.id, outcome: null });
    expect(holds.get(t3.id)).toEqual({ approvalId: a3.id, outcome: "rejected" });
    expect(holds.has(t2.id)).toBe(false);
    expect(holds.has(t4.id)).toBe(false);
    expect(holds.has(t5.id)).toBe(false);
    expect((await repos.approvals.holds(r.db, r.B.businessId, [t1.id])).size).toBe(0);
    expect((await repos.approvals.holds(r.db, r.A.businessId, [])).size).toBe(0);
  });
});
