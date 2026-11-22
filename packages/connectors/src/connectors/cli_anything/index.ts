/** CLI-Anything program connectors (see ./tools.ts). Live runs go through the host's `cliRunner`; the mock replays nothing and says so. */
import { uuid } from "@foundmill/shared";
import { ConfigError, VendorError, type Connector } from "../../contract";
import { buildLiveConnector, buildMockConnector, healthResult } from "../../define";
import { MOCK_NOW, mockHealth, mockIntegrationRecord, perBusiness, stableHash } from "../../mock-utils";
import { resolveLiveOptions, type CliRunner, type LiveConnectorOptions } from "../../platform";
import { CLI_COMMANDS, CLI_NOTICE, CLI_PROGRAM_KEYS, CLI_RATE_LIMITS, CLI_STAGED_NOTICE, cliTools, type CliOutT, type CliProgramName } from "./tools";

export { CLI_COMMANDS, CLI_PROGRAM_KEYS, cliTools, type CliProgramName } from "./tools";

/** One folder per business inside the sandbox, so a program can read and write only that project's files. */
const folderOf = (businessId: string): string => `p${stableHash(businessId, 24)}`;
const NAME: Record<CliProgramName, string> = { inkscape: "Inkscape", libreoffice: "LibreOffice", ffmpeg: "FFmpeg", gimp: "GIMP" };
const MOCK_FILE_BYTES = 2_048;

type Handlers = Record<string, (args: never, ctx: { businessId: string }) => Promise<unknown>>;

function spec(program: CliProgramName, mode: "live" | "mock", handlers: Handlers, now: () => Date, extra: object) {
  const key = CLI_PROGRAM_KEYS[program];
  return {
    key,
    displayName: `${NAME[program]} (in the project's sandbox)`,
    phase: 1 as const,
    auth: { kind: "none" as const },
    tools: cliTools(program),
    rateLimits: CLI_RATE_LIMITS,
    now,
    handlers: handlers as never,
    ...extra,
    mode,
  };
}

export function createCliConnector(program: CliProgramName, options: LiveConnectorOptions = {}): Connector {
  const { cliRunner, now } = resolveLiveOptions(options);
  const key = CLI_PROGRAM_KEYS[program];
  const runner = (): CliRunner => {
    if (!cliRunner) throw new ConfigError(key, "the sandbox runner", "only the gateway can run programs");
    return cliRunner;
  };
  const handlers: Handlers = Object.fromEntries(CLI_COMMANDS[program].map((c) => [c.spec.name, async (args: never, ctx: { businessId: string }): Promise<CliOutT> => {
    const r = await runner().run({ businessId: ctx.businessId, program, argv: c.argv(args), folder: folderOf(ctx.businessId) });
    if (!r.ok) throw new VendorError(key, 422, `${NAME[program]} could not do that: ${r.stderr || r.summary || "it failed"}`.slice(0, 600));
    return { ok: true, summary: r.summary.slice(0, 1_000), produced: r.produced, staged: true, notice: CLI_STAGED_NOTICE };
  }]));
  handlers.release_output = async (args: { path: string; target: "logo" }, ctx) => runner().release({ businessId: ctx.businessId, folder: folderOf(ctx.businessId), path: args.path, target: args.target }) as never;
  return buildLiveConnector(
    {
      ...spec(program, "live", handlers, now, {}),
      connect: async (businessId: string) => ({ id: uuid(), businessId, connectorKey: key, status: "connected" as const, scopes: [], accountLabel: NAME[program], externalAccountId: null, config: {}, credentialRef: null, expiresAt: null, lastHealthAt: now().toISOString(), createdAt: now().toISOString() }),
      healthcheck: async () => healthResult(cliRunner ? "connected" : "disconnected", now().getTime(), { now }),
    } as never,
    createCliMock(program),
  );
}

export function createCliMock(program: CliProgramName, now: () => Date = () => MOCK_NOW) {
  const key = CLI_PROGRAM_KEYS[program];
  const files = perBusiness(() => new Map<string, number>());
  const handlers: Handlers = Object.fromEntries(CLI_COMMANDS[program].map((c) => [c.spec.name, async (args: never, ctx: { businessId: string }): Promise<CliOutT> => {
    const argv = c.argv(args);
    const out = (args as { output?: string }).output;
    if (out) files(ctx.businessId).set(out, MOCK_FILE_BYTES + (parseInt(stableHash(argv, 4), 16) % 1_000));
    return { ok: true, summary: `Simulated ${NAME[program]} ${c.spec.name}`, produced: out ? [{ path: out, bytes: files(ctx.businessId).get(out)! }] : [], staged: true, notice: `${CLI_NOTICE} ${CLI_STAGED_NOTICE}`, simulated: true };
  }]));
  handlers.release_output = async (args: { path: string; target: "logo" }, ctx) => {
    if (!files(ctx.businessId).has(args.path)) throw Object.assign(new Error(`${args.path} is not in the working folder`), { status: 404 });
    return { released: true, target: args.target, path: args.path, where: "the business logo", simulated: true, notice: CLI_NOTICE };
  };
  const mock = buildMockConnector({
    ...spec(program, "mock", handlers, now, {}),
    connect: async (businessId: string) => mockIntegrationRecord(key, businessId, { accountLabel: `${NAME[program]} (simulated)` }),
    healthcheck: async () => mockHealth(key, {}),
  } as never);
  return Object.assign(mock, { reset: () => files.clear() });
}

export const createInkscapeConnector = (o?: LiveConnectorOptions) => createCliConnector("inkscape", o);
export const createLibreofficeConnector = (o?: LiveConnectorOptions) => createCliConnector("libreoffice", o);
export const createFfmpegConnector = (o?: LiveConnectorOptions) => createCliConnector("ffmpeg", o);
export const createGimpConnector = (o?: LiveConnectorOptions) => createCliConnector("gimp", o);
