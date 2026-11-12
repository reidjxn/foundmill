/** Development › Code: the code agents saved on code tasks (dev.code.list / files / file), per business. */
import { repos } from "@foundmill/db";
import { AppError } from "@foundmill/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeSavedFile, SAVED_FILE_TEXT_LIMIT } from "../routers/dev";
import type { ApiGatewayClient, GatewayRepository } from "../services/gateway";
import { createApiHarness, type ApiHarness } from "./harness";

const text = (s: string) => new TextEncoder().encode(s);

describe("dev.code", () => {
  let hz: ApiHarness;
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "code" });
  }, 120_000);
  afterAll(() => hz.close());

  it("lists tasks with saved code, their files and history, and reads a file as text", async () => {
    const { businessId, taskId, agent2Id, ownerId } = hz.A;
    const first = await repos.workspaces.save(hz.db, businessId, { taskId, agentId: agent2Id, branch: `agent/${taskId}`, files: [{ path: "src/match.ts", content: text("export const match = () => true;\n") }] });
    const second = await repos.workspaces.save(hz.db, businessId, { taskId, agentId: agent2Id, files: [{ path: "src/match.ts", content: text("export const match = () => false;\n") }, { path: "logo.png", content: new Uint8Array([137, 80, 78, 71, 0, 1]) }] });
    const owner = hz.caller({ userId: ownerId });

    const list = await owner.dev.code.list({ businessId });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ taskId, snapshots: 2, latest: { id: second.snapshot!.id, fileCount: 2, added: 1, changed: 1 } });

    const files = await owner.dev.code.files({ businessId, taskId });
    expect(files.branch).toBe(`agent/${taskId}`);
    expect(files.snapshot?.files.map((f) => f.path)).toEqual(["logo.png", "src/match.ts"]);
    expect(files.history.map((h) => h.id)).toEqual([second.snapshot!.id, first.snapshot!.id]);
    const older = await owner.dev.code.files({ businessId, taskId, snapshotId: first.snapshot!.id });
    expect(older.snapshot?.files.map((f) => f.path)).toEqual(["src/match.ts"]);

    expect(await owner.dev.code.file({ businessId, snapshotId: second.snapshot!.id, path: "src/match.ts" })).toMatchObject({ binary: false, truncated: false, text: "export const match = () => false;\n" });
    expect(await owner.dev.code.file({ businessId, snapshotId: first.snapshot!.id, path: "src/match.ts" })).toMatchObject({ text: "export const match = () => true;\n" });
    expect(await owner.dev.code.file({ businessId, snapshotId: second.snapshot!.id, path: "logo.png" })).toMatchObject({ binary: true, text: null, size: 6 });
    await expect(owner.dev.code.file({ businessId, snapshotId: second.snapshot!.id, path: "missing.ts" })).rejects.toThrow(/not found/);
  });

  it("keeps another business's code out of reach", async () => {
    const { businessId, taskId } = hz.A;
    const snapshot = (await repos.workspaces.latest(hz.db, businessId, taskId))!;
    const outsider = hz.caller({ userId: hz.B.ownerId });
    expect(await outsider.dev.code.list({ businessId: hz.B.businessId })).toEqual([]);
    await expect(outsider.dev.code.file({ businessId: hz.B.businessId, snapshotId: snapshot.id, path: "src/match.ts" })).rejects.toThrow(/not found/);
    await expect(outsider.dev.code.list({ businessId })).rejects.toThrow();
  });

  it("checks the task on an earlier snapshot and gives members a read-only view", async () => {
    const { businessId, taskId, task2Id, memberId, viewerId } = hz.A;
    const snapshot = (await repos.workspaces.latest(hz.db, businessId, taskId))!;
    const member = hz.caller({ userId: memberId });
    await expect(member.dev.code.files({ businessId, taskId: task2Id, snapshotId: snapshot.id })).rejects.toThrow(/not found/);
    expect((await hz.caller({ userId: viewerId }).dev.code.files({ businessId, taskId })).snapshot?.id).toBe(snapshot.id);
    await expect(member.dev.code.forget({ businessId, taskId })).rejects.toThrow(/owner|admin|administration/i);
    await expect(hz.caller({ userId: viewerId }).dev.code.forget({ businessId, taskId })).rejects.toThrow();
  });

  it("owners forget a task's saved code, audited; a task with none is not found", async () => {
    const { businessId, taskId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await owner.dev.code.forget({ businessId, taskId })).toEqual({ snapshots: 2, blobs: 3 });
    expect(await owner.dev.code.list({ businessId })).toEqual([]);
    await expect(owner.dev.code.forget({ businessId, taskId })).rejects.toThrow(/not found/);
    const audit = await repos.audit.list(hz.db, businessId, { action: "dev.code.forget" });
    expect(audit.items[0]).toMatchObject({ actorKind: "user", actorId: ownerId, target: { kind: "task", id: taskId } });
  });

  it("reads and sets the repository saved code is pushed to; members cannot set it", async () => {
    const { businessId, ownerId, memberId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect(await owner.dev.code.repository({ businessId })).toEqual({ connected: false, status: null, repository: null, simulated: true });
    await expect(owner.dev.code.setRepository({ businessId, repository: "acme/shop" })).rejects.toThrow(/connect GitHub/);
    await repos.integrations.upsert(hz.db, businessId, { connectorKey: "github", status: "mock", authKind: "app", settings: { externalAccountId: "1", config: {} } });
    // The simulated GitHub knows every repository a business names: private, with a stable id, pinned with the choice.
    expect(await owner.dev.code.setRepository({ businessId, repository: "https://github.com/Acme/shop.git" })).toMatchObject({ repository: { fullName: "Acme/shop", owner: "Acme", repo: "shop", writeEnabled: false, repoId: expect.any(Number) } });
    expect(await owner.dev.code.setRepository({ businessId, repository: "Acme/shop", pushEnabled: true })).toMatchObject({ repository: { fullName: "Acme/shop", writeEnabled: true } });
    expect(await owner.dev.code.repository({ businessId })).toMatchObject({ connected: true, status: "mock", repository: { fullName: "Acme/shop" }, simulated: true });
    await expect(hz.caller({ userId: memberId }).dev.code.setRepository({ businessId, repository: "evil/repo" })).rejects.toThrow();
    await expect(owner.dev.code.setRepository({ businessId, repository: "no slash" })).rejects.toThrow(/owner\/name/);
    const audit = await repos.audit.list(hz.db, businessId, { action: "dev.code.set_repository" });
    expect(audit.items[0]).toMatchObject({ actorId: ownerId, details: { repository: "Acme/shop", pushEnabled: true } });
    expect(await owner.dev.code.setRepository({ businessId, repository: null })).toEqual({ repository: null });
    expect((await repos.integrations.getByKey(hz.db, businessId, "github"))?.settings).not.toHaveProperty("repoId");
  });

  it("keeps the chosen repository when GitHub is connected again", async () => {
    const { businessId, ownerId } = hz.B;
    const owner = hz.caller({ userId: ownerId });
    await owner.integrations.connect({ businessId, connectorKey: "github", input: {} });
    await owner.dev.code.setRepository({ businessId, repository: "acme/shop", pushEnabled: true });
    await owner.integrations.connect({ businessId, connectorKey: "github", input: {} });
    expect((await owner.dev.code.repository({ businessId })).repository).toMatchObject({ fullName: "acme/shop", writeEnabled: true });
    const list = await owner.integrations.list({ businessId });
    expect(list.catalogue.find((c) => c.key === "github")).toMatchObject({ live: false, integration: { status: "mock" } });
  });

  it("returns each save's push result with its history", async () => {
    const { businessId, task2Id, ownerId } = hz.A;
    const saved = await repos.workspaces.save(hz.db, businessId, { taskId: task2Id, files: [{ path: "a.ts", content: text("x") }] });
    await repos.workspaces.recordPush(hz.db, businessId, saved.snapshot!.id, { repo: "Acme/shop", branch: `agent/${task2Id}`, commitSha: "c".repeat(40), url: "https://github.com/Acme/shop/commit/ccc" });
    const files = await hz.caller({ userId: ownerId }).dev.code.files({ businessId, taskId: task2Id });
    expect(files.snapshot).toMatchObject({ pushedRepo: "Acme/shop", pushedBranch: `agent/${task2Id}`, pushedCommitSha: "c".repeat(40), pushError: null });
    expect(files.history[0]).toMatchObject({ pushedCommitSha: "c".repeat(40), pushedUrl: "https://github.com/Acme/shop/commit/ccc" });
  });

  it("decodes text up to the limit and calls non-UTF-8 binary", () => {
    expect(decodeSavedFile(text("héllo"))).toEqual({ binary: false, truncated: false, text: "héllo" });
    expect(decodeSavedFile(new Uint8Array([0xff, 0xfe, 0x41]))).toMatchObject({ binary: true });
    const big = decodeSavedFile(new Uint8Array(SAVED_FILE_TEXT_LIMIT + 10).fill(65));
    expect(big).toMatchObject({ binary: false, truncated: true });
    expect(big.text).toHaveLength(SAVED_FILE_TEXT_LIMIT);
  });
});

describe("dev.code.setRepository against live GitHub (through the gateway)", () => {
  let hz: ApiHarness;
  const asked: { businessId: string; owner: string; repo: string }[] = [];
  const answers: Record<string, GatewayRepository | "missing"> = {
    "acme/shop": { id: 501, fullName: "acme/shop", private: true, defaultBranch: "main" },
    "acme/public-site": { id: 502, fullName: "acme/public-site", private: false, defaultBranch: "main" },
    "acme/old-name": { id: 503, fullName: "acme/new-name", private: true, defaultBranch: "main" },
    "acme/gone": "missing",
  };
  const unused = async (): Promise<never> => {
    throw new Error("unused");
  };
  const gateway: ApiGatewayClient = {
    connect: unused,
    health: unused,
    createCheckout: unused,
    checkDomains: unused,
    generatePortrait: unused,
    sendPush: unused,
    validateKey: unused,
    registryLookup: unused,
    confirmFollow: unused,
    notifyEmail: unused,
    async repository(businessId, owner, repo) {
      asked.push({ businessId, owner, repo });
      const answer = answers[`${owner}/${repo}`.toLowerCase()];
      if (!answer || answer === "missing") throw new AppError("repository_not_accessible", `The GitHub installation cannot access ${owner}/${repo}`, 404);
      return { mode: "live", repository: answer };
    },
  };
  beforeAll(async () => {
    hz = await createApiHarness({ prefix: "code-live", gateway, env: { LIVE_CONNECTORS: "github" } });
    await repos.integrations.upsert(hz.db, hz.A.businessId, { connectorKey: "github", status: "connected", authKind: "app", settings: { externalAccountId: "42" } });
  }, 120_000);
  afterAll(() => hz.close());

  it("pins GitHub's id of a private repository the installation reaches", async () => {
    const { businessId, ownerId } = hz.A;
    const r = await hz.caller({ userId: ownerId }).dev.code.setRepository({ businessId, repository: "acme/shop", pushEnabled: true });
    expect(r.repository).toMatchObject({ fullName: "acme/shop", repoId: 501, writeEnabled: true });
    expect(asked.at(-1)).toEqual({ businessId, owner: "acme", repo: "shop" });
    const audit = await repos.audit.list(hz.db, businessId, { action: "dev.code.set_repository" });
    expect(audit.items[0]).toMatchObject({ details: { repository: "acme/shop", repoId: 501 } });
  });

  it("refuses a public repository and one the installation cannot reach with a clear message, keeping the earlier choice", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    await expect(owner.dev.code.setRepository({ businessId, repository: "acme/public-site" })).rejects.toThrow("acme/public-site is public: agents work only on private repositories. Make it private on GitHub, or choose another repository");
    await expect(owner.dev.code.setRepository({ businessId, repository: "acme/gone" })).rejects.toThrow("The GitHub installation cannot access acme/gone: add it to the installation on GitHub, or choose another repository");
    expect(await repos.integrations.codeRepository(hz.db, businessId)).toMatchObject({ fullName: "acme/shop", repoId: 501 });
  });

  it("stores GitHub's own name for a renamed repository, and asks nothing for a name that could never be stored", async () => {
    const { businessId, ownerId } = hz.A;
    const owner = hz.caller({ userId: ownerId });
    expect((await owner.dev.code.setRepository({ businessId, repository: "acme/old-name" })).repository).toMatchObject({ fullName: "acme/new-name", repoId: 503 });
    const before = asked.length;
    await expect(owner.dev.code.setRepository({ businessId, repository: "no slash" })).rejects.toThrow(/owner\/name/);
    await expect(hz.caller({ userId: hz.B.ownerId }).dev.code.setRepository({ businessId: hz.B.businessId, repository: "acme/shop" })).rejects.toThrow(/connect GitHub/);
    expect(asked.length).toBe(before);
  });
});
