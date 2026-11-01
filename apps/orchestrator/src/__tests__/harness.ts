/**
 * Test harness: real repositories on PGlite (the same migrations staging runs), an in-memory Redis for the session
 * streams, the memory control bus, the mock model client, the replay sandbox and a fake clock. Nothing touches the
 * network. One harness per suite file; `close()` tears the database down.
 */
import { listTemplates, initialVersionFromTemplate } from "@foundmill/agents";
import { createBusinessFixture, type BusinessFixture } from "@foundmill/db/__tests__/rls/fixtures";
import { createTestDb, type TestHarness } from "@foundmill/db/testing/pglite";
import { repos, type Db } from "@foundmill/db";
import { MemoryRedis } from "@foundmill/events";
import { createModelClient } from "@foundmill/models";
import { MockSandboxProvider, RECORDINGS, type MockSandboxOptions } from "@foundmill/sandbox";
import { createLogger } from "@foundmill/shared/logger";
import { FakeClock } from "../clock";
import { createOfflineComposerClient } from "../composer-client";
import { MemoryControlBus } from "../control-bus";
import { createDeps, type OrchestratorDeps } from "../deps";
import { loadOrchestratorEnv } from "../env";
import { createOfflineGatewayClient } from "../gateway-client";

export interface OrchestratorTestHarness {
  h: TestHarness;
  db: Db;
  fixture: BusinessFixture;
  businessId: string;
  /** The fixture's Chief of Staff (has a live version). */
  chiefId: string;
  /** A worker hired from a real template (backend engineer) with a live version. */
  workerId: string;
  /** The fixture's code task, assigned to the worker. */
  codeTaskId: string;
  deps: OrchestratorDeps;
  redis: MemoryRedis;
  control: MemoryControlBus;
  clock: FakeClock;
  gateway: ReturnType<typeof createOfflineGatewayClient>;
  sandbox: MockSandboxProvider;
  close(): Promise<void>;
}

export interface HarnessOptions {
  prefix?: string;
  sandbox?: MockSandboxOptions;
  clockStart?: string;
}

export async function setupOrchestratorHarness(options: HarnessOptions = {}): Promise<OrchestratorTestHarness> {
  process.env.APP_ENV = "test";
  process.env.INTEGRATIONS_MODE = "mock";
  process.env.MODEL_MODE = "mock";
  const h = await createTestDb();
  const db = h.db as unknown as Db;
  const fixture = await createBusinessFixture(h, `${options.prefix ?? "orch"}-${Math.random().toString(36).slice(2, 7)}`);
  const businessId = fixture.businessId;

  // A real worker template so prompts, tools and skills resolve.
  const template = listTemplates({ family: "worker" }).find((t) => t.agentType === "backend_engineer") ?? listTemplates({ family: "worker" })[0]!;
  const spec = initialVersionFromTemplate(template, "00000000-0000-0000-0000-000000000000");
  const worker = await repos.agents.create(db, businessId, {
    name: "Test Engineer",
    role: template.role,
    agentType: template.agentType,
    layer: "worker",
    descriptionMd: template.description,
    departmentIds: [fixture.departmentId],
    modelKey: template.modelKey,
    status: "idle",
    autonomy: spec.autonomy,
    initialVersion: { instructions: spec.instructions, tools: spec.tools, modelKey: spec.modelKey },
  });
  await repos.tasks.reassign(db, businessId, fixture.taskId, worker.id);

  const redis = new MemoryRedis();
  const control = new MemoryControlBus();
  const clock = new FakeClock(options.clockStart ?? "2026-10-05T08:00:00.000Z");
  const gateway = createOfflineGatewayClient();
  const sandbox = new MockSandboxProvider({ speed: Infinity, autoplay: false, holds: { autoResolveAfterMs: 1 }, recordings: RECORDINGS, ...options.sandbox });
  const env = loadOrchestratorEnv({ APP_ENV: "test", INTEGRATIONS_MODE: "mock", MODEL_MODE: "mock" });
  const deps = createDeps({
    env,
    db,
    redis,
    control,
    models: createModelClient({ mode: "mock" }),
    gateway,
    composer: createOfflineComposerClient(),
    sandboxProvider: sandbox,
    vault: null,
    clock,
    log: createLogger("orchestrator-test", "silent"),
  });
  return {
    h,
    db,
    fixture,
    businessId,
    chiefId: fixture.agentId,
    workerId: worker.id,
    codeTaskId: fixture.taskId,
    deps,
    redis,
    control,
    clock,
    gateway,
    sandbox,
    close: () => h.close(),
  };
}

/** Open an agent_sessions row the way apps/api does before starting the agentSession workflow (its workflow id is `session:<id>`). */
export async function openSessionRow(t: OrchestratorTestHarness, agentId: string, taskId: string): Promise<string> {
  const agent = await repos.agents.get(t.db, t.businessId, agentId);
  // Started on the harness clock, as the dispatcher starts its sessions, so ordering never depends on the real date.
  const session = await repos.agents.createSession(t.db, t.businessId, { agentId, versionId: agent.currentVersionId, taskId, modelKey: agent.modelKey, startedAt: t.clock.now() });
  return session.id;
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
