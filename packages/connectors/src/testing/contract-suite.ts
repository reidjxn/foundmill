/**
 * The contract test-suite every connector runs against its mock and, when credentials exist in the
 * environment, against the live implementation (docs/ARCHITECTURE.md §8). Asserts the BUILD §13.1 surface,
 * policy-hint completeness, hard-gate refusal, argument/output validation, untrusted wrapping, webhook
 * verification (positive / tampered / replay) and mock determinism.
 */
import { describe, expect, it } from "vitest";
import type { EventType } from "@foundmill/shared";
import { safeParseEvent } from "@foundmill/events/catalogue";
import type { Connector, ConnectorMode, DecryptedCredential, IntegrationRecord, ToolContext, ToolLogger, ToolResult } from "../contract";
import { isMockConnector } from "../define";
import { mockIntegrationRecord, uuidFromSeed } from "../mock-utils";
import { isUntrusted } from "../quarantine";

export const TEST_BUSINESS_ID = uuidFromSeed("test", "business", "northwind");
export const TEST_AGENT_ID = uuidFromSeed("test", "agent", "chief-of-staff");
export const TEST_SESSION_ID = uuidFromSeed("test", "session", "1");

export interface CollectedLog {
  level: "debug" | "info" | "warn" | "error";
  args: unknown[];
}

export function collectingLogger(): ToolLogger & { entries: CollectedLog[] } {
  const entries: CollectedLog[] = [];
  const push = (level: CollectedLog["level"]) => (...args: unknown[]) => void entries.push({ level, args });
  return { entries, debug: push("debug"), info: push("info"), warn: push("warn"), error: push("error") };
}

export function makeToolContext(connector: Connector, overrides: Partial<ToolContext> = {}): ToolContext {
  const mode: ConnectorMode = overrides.mode ?? (isMockConnector(connector) ? "mock" : "live");
  return {
    businessId: TEST_BUSINESS_ID,
    agentId: TEST_AGENT_ID,
    sessionId: TEST_SESSION_ID,
    integration: mockIntegrationRecord(connector.key, TEST_BUSINESS_ID, mode === "live" ? { status: "connected" } : {}),
    log: collectingLogger(),
    mode,
    ...overrides,
  };
}

/** Tests may read process.env to decide whether live suites run; connectors themselves never do. */
export function envKeysPresent(...names: string[]): boolean {
  return names.every((n) => typeof process.env[n] === "string" && process.env[n]!.length > 0);
}

export interface ContractCall {
  tool: string;
  args: unknown;
  /** Default true. */
  expectOk?: boolean;
  check?(result: ToolResult): void | Promise<void>;
}

export interface ContractWebhookCase {
  name: string;
  /** Index into `connector.webhooks`. Default 0. */
  index?: number;
  /**
   * A correctly signed request. Built fresh per call (bodies are single-read). When `replay` is set, every call
   * must also be a *distinct* delivery (vary the event id or timestamp), because the connector's mock keeps one
   * ReplayGuard for the whole test file and earlier cases have already delivered what `valid()` returned.
   */
  valid(): Request;
  /** A request whose signature must be rejected. */
  tampered?(): Request;
  /** When true, delivering `valid()` twice must fail verification the second time. */
  replay?: boolean;
  /** Expected number of platform events from `normalise(valid())`. */
  expectEvents?: number;
  expectTypes?: EventType[];
}

/**
 * Tools that write but carry no outward hint, each with the reason it never contacts a third party, spends or cannot be
 * undone (WP-11 T11, A7-16). The gateway lets such a tool run in every mode, so the list is reviewed: a new entry, or a
 * tool leaving it for a hint, is the founder's call, because a tool that gains a hint starts asking in assisted mode.
 */
export const INTERNAL_WRITE_TOOLS: ReadonlyMap<string, string> = new Map([
  ["stripe:create_billing_portal_session", "a link to Stripe's page for the platform's own subscriber; refused on any business's account"],
  ["e2b:pause_sandbox", "pauses the project's own sandbox; resume undoes it"],
  ["github:create_branch", "a branch in the project's repository; deleting it undoes it"],
  ["github:commit_files", "a commit on an agent's working branch, never the default branch; merging is a hard stop"],
  ["github:run_checks", "starts the repository's own CI on an agent's branch"],
  ["github:open_pr", "a pull request in the project's repository; merging is a hard stop"],
  ["github:update_branch", "brings an agent's working branch up to date with the default branch"],
  ["gmail:create_draft", "a draft in the founder's mailbox; nothing is sent until the founder sends it"],
  ["google_drive:create_doc", "a document in the founder's Drive"],
  ["google_drive:append_to_doc", "text appended to a document in the founder's Drive; the document's history undoes it"],
  ["notion:create_page", "a page in the founder's workspace"],
  ["notion:append_paragraphs", "paragraphs appended to a page in the founder's workspace"],
  ["onesignal:send_push", "service-only: the platform's own app notifying founders' own phones; agents never call it"],
  ["sendgrid:add_suppression", "stops mail to an address that opted out; only ever sends less"],
  ["sendgrid:create_campaign", "a draft single send; nothing is sent until schedule_campaign, which asks"],
  ["shopify:create_draft_order", "a draft order in the founder's store; nobody is charged or emailed"],
  ["stripe:create_customer", "a customer record in the founder's Stripe; no email is sent"],
]);

export interface ContractSuiteOptions {
  connector: Connector;
  mode: ConnectorMode;
  integration?: IntegrationRecord;
  credential?: DecryptedCredential;
  connectInput?: unknown;
  /** Skip connect() (live OAuth connectors need a code we cannot fabricate). */
  skipConnect?: boolean;
  calls?: ContractCall[];
  webhooks?: ContractWebhookCase[];
  /** Call each `calls` entry twice and require identical results. Default: mode === "mock". */
  deterministic?: boolean;
}

const SNAKE = /^[a-z][a-z0-9_]{1,63}$/;

export function describeConnectorContract(title: string, opts: ContractSuiteOptions): void {
  const { connector, mode } = opts;
  const ctx = (): ToolContext => makeToolContext(connector, { mode, ...(opts.integration ? { integration: opts.integration } : {}), ...(opts.credential ? { credential: opts.credential } : {}) });

  describe(title, () => {
    it("exposes the BUILD §13.1 surface", () => {
      expect(connector.key).toMatch(SNAKE);
      expect(connector.displayName.length).toBeGreaterThan(1);
      expect([1, 2, 3]).toContain(connector.phase);
      expect(["oauth", "api_key", "app", "none"]).toContain(connector.auth.kind);
      expect(Array.isArray(connector.tools)).toBe(true);
      expect(connector.tools.length).toBeGreaterThan(0);
      expect(typeof connector.callTool).toBe("function");
      expect(typeof connector.connect).toBe("function");
      expect(typeof connector.healthcheck).toBe("function");
      expect(connector.rateLimits).toBeTypeOf("object");
      expect(connector.mock).toBeDefined();
      expect(connector.mock.key).toBe(connector.key);
      expect(isMockConnector(connector.mock)).toBe(true);
      expect(connector.mock.mock).toBe(connector.mock);
      if (mode === "mock") expect(isMockConnector(connector)).toBe(true);
    });

    it("has a policy hint for every tool and a tool for every hint", () => {
      const names = connector.tools.map((t) => t.name);
      expect(new Set(names).size).toBe(names.length);
      for (const t of connector.tools) {
        expect(t.name).toMatch(SNAKE);
        expect(t.description.length).toBeGreaterThan(10);
        expect(t.inputSchema.type).toBe("object");
        if (t.outputSchema) expect(t.outputSchema.type).toBe("object");
        expect(connector.policyHints, `policyHints missing for ${connector.key}.${t.name}`).toHaveProperty(t.name);
        const hint = connector.policyHints[t.name]!;
        for (const [k, v] of Object.entries(hint)) {
          expect(["spendsMoney", "contactsThirdParty", "requiresKitMode", "irreversible", "hardGate"]).toContain(k);
          expect(typeof v).toBe("boolean");
        }
      }
      for (const name of Object.keys(connector.policyHints)) expect(names).toContain(name);
    });

    it("a tool whose hints are all false either only reads or is a reviewed write inside the founder's own accounts", () => {
      for (const t of connector.tools) {
        const ref = `${connector.key}:${t.name}`;
        const h = connector.policyHints[t.name] ?? {};
        const quiet = !(h.spendsMoney || h.contactsThirdParty || h.irreversible || h.hardGate);
        if (INTERNAL_WRITE_TOOLS.has(ref)) {
          expect(quiet, `${ref} is on INTERNAL_WRITE_TOOLS but declares an outward hint`).toBe(true);
          expect(t.annotations?.readOnlyHint, `${ref} writes, so it must not tell MCP clients it is read-only`).toBe(false);
        } else if (quiet) {
          expect(t.annotations?.readOnlyHint, `${ref} has no outward hint and writes: add it to INTERNAL_WRITE_TOOLS with its reason, or give it the hint`).toBe(true);
        }
      }
    });

    it("mock and live sides agree on tools and policy hints", () => {
      const mockNames = connector.mock.tools.map((t) => t.name).sort();
      const names = connector.tools.map((t) => t.name).sort();
      expect(mockNames).toEqual(names);
      expect(connector.mock.policyHints).toEqual(connector.policyHints);
      expect(connector.mock.auth).toEqual(connector.auth);
      expect(connector.mock.phase).toBe(connector.phase);
    });

    it("never executes hard-gated tools; it returns a human-action descriptor", async () => {
      const gated = connector.tools.filter((t) => connector.policyHints[t.name]?.hardGate);
      for (const t of gated) {
        const result = await connector.callTool(t.name, {}, ctx());
        expect(result.ok).toBe(false);
        expect(result.error?.code).toBe("hard_gate");
        expect(result.costMinor).toBe(0);
        expect(result.data).toMatchObject({ connector: connector.key, tool: t.name, reason: "hard_gate" });
        expect((result.data as { instructions: string }).instructions.length).toBeGreaterThan(10);
        // Hard gates are irreversible by definition and cannot be marked kit-mode-only instead.
        expect(connector.policyHints[t.name]!.irreversible ?? true).toBe(true);
      }
    });

    it("rejects unknown tools and invalid arguments without calling anything", async () => {
      const unknown = await connector.callTool("definitely_not_a_tool", {}, ctx());
      expect(unknown.ok).toBe(false);
      expect(unknown.error?.code).toBe("unknown_tool");
      const strict = connector.tools.find((t) => (t.inputSchema.required ?? []).length > 0 && !connector.policyHints[t.name]?.hardGate);
      if (strict) {
        const bad = await connector.callTool(strict.name, { __nonsense: 1 }, ctx());
        expect(bad.ok).toBe(false);
        expect(bad.error?.code).toBe("invalid_args");
      }
    });

    if (!opts.skipConnect) {
      it("connect() returns an IntegrationRecord for the business", async () => {
        const record = await connector.connect(TEST_BUSINESS_ID, opts.connectInput ?? {});
        expect(record.businessId).toBe(TEST_BUSINESS_ID);
        expect(record.connectorKey).toBe(connector.key);
        expect(["connected", "degraded", "expired", "disconnected", "mock"]).toContain(record.status);
        expect(Array.isArray(record.scopes)).toBe(true);
        if (mode === "mock") expect(record.status).toBe("mock");
      });
    }

    it("healthcheck() returns a HealthResult", async () => {
      const health = await connector.healthcheck(ctx().integration);
      expect(typeof health.ok).toBe("boolean");
      expect(health.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(health.latencyMs).toBeGreaterThanOrEqual(0);
      if (mode === "mock") expect(health.status).toBe("mock");
    });

    for (const call of opts.calls ?? []) {
      it(`${call.tool}(${JSON.stringify(call.args).slice(0, 60)}) ${call.expectOk === false ? "fails as expected" : "succeeds"}`, async () => {
        const result = await connector.callTool(call.tool, call.args, ctx());
        if (call.expectOk !== false) expect(result.error, `unexpected error: ${JSON.stringify(result.error)}`).toBeUndefined();
        expect(result.ok).toBe(call.expectOk ?? true);
        expect(typeof result.costMinor).toBe("number");
        expect(result.costMinor).toBeGreaterThanOrEqual(0);
        if (result.untrusted) {
          expect(isUntrusted(result.data)).toBe(true);
        } else if (result.ok) {
          expect(isUntrusted(result.data)).toBe(false);
        }
        await call.check?.(result);
        if (opts.deterministic ?? mode === "mock") {
          const again = await connector.callTool(call.tool, call.args, ctx());
          expect(again).toEqual(result);
        }
      });
    }

    for (const wh of opts.webhooks ?? []) {
      describe(`inbound event ${wh.name}`, () => {
        const webhook = () => {
          const list = connector.webhooks ?? [];
          const w = list[wh.index ?? 0];
          if (!w) throw new Error(`${connector.key} has no inbound event handler at index ${wh.index ?? 0}`);
          return w;
        };
        it("has a mount path scoped by business", () => {
          expect(webhook().path).toMatch(/^\/webhooks\/[a-z0-9_-]+\/:businessId$/);
        });
        it("verifies a correctly signed delivery and normalises it into catalogue events", async () => {
          const req = wh.valid();
          expect(await webhook().verify(req)).toBe(true);
          const events = await webhook().normalise(req);
          if (wh.expectEvents !== undefined) expect(events).toHaveLength(wh.expectEvents);
          for (const e of events) {
            const parsed = safeParseEvent(e);
            expect(parsed.ok, parsed.ok ? "" : parsed.error.message).toBe(true);
          }
          if (wh.expectTypes) expect(events.map((e) => e.type)).toEqual(wh.expectTypes);
        });
        if (wh.tampered) {
          it("rejects a tampered or unsigned delivery", async () => {
            expect(await webhook().verify(wh.tampered!())).toBe(false);
          });
        }
        if (wh.replay) {
          it("rejects a replayed delivery", async () => {
            // The same delivery twice: verify() clones the body, so one Request can be checked again.
            const delivery = wh.valid();
            expect(await webhook().verify(delivery), "a fresh delivery must verify (valid() has to produce a new delivery per call)").toBe(true);
            expect(await webhook().verify(delivery)).toBe(false);
          });
        }
      });
    }
  });
}
