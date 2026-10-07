/**
 * Provider selection (docs/ARCHITECTURE.md §3 modes, §10 "acquires a sandbox (`packages/sandbox`)").
 *
 * - `INTEGRATIONS_MODE=mock` → the replay runner, always.
 * - `INTEGRATIONS_MODE=live` → E2B when `E2B_API_KEY` is set, else local Docker when the daemon answers,
 *   else `SandboxUnavailableError` (503) unless the caller names a `fallback` mode. Live never silently
 *   degrades to a replay: a founder watching the Training Ground must not mistake a recording for work.
 * - An explicit `mode` wins and is checked for availability the same way.
 */
import { loadEnv } from "@foundmill/shared";
import { DockerSandboxProvider, type DockerSandboxOptions } from "./docker";
import { E2bSandboxProvider, type E2bSandboxOptions } from "./e2b";
import { SandboxUnavailableError } from "./errors";
import { MockSandboxProvider, type MockSandboxOptions } from "./mock/replay";
import { SandboxMode as SandboxModeSchema, type ProviderAvailability, type SandboxMode, type SandboxProvider } from "./types";

export interface ProviderSelectionInput {
  integrationsMode: "mock" | "live";
  /** Explicit request (`SANDBOX_MODE`-style override or a per-business setting). */
  requested?: SandboxMode | undefined;
  e2bAvailable: boolean;
  dockerAvailable: boolean;
}

export interface ProviderSelection {
  mode: SandboxMode | null;
  reason: string;
}

/** Pure selection rule; `getSandboxProvider` feeds it real availability. */
export function resolveSandboxMode(input: ProviderSelectionInput): ProviderSelection {
  const availability: Record<SandboxMode, boolean> = { mock: true, e2b: input.e2bAvailable, docker: input.dockerAvailable };
  if (input.requested) {
    return availability[input.requested]
      ? { mode: input.requested, reason: `requested ${input.requested}` }
      : { mode: null, reason: `requested ${input.requested} but it is not available` };
  }
  if (input.integrationsMode === "mock") return { mode: "mock", reason: "INTEGRATIONS_MODE=mock replays recorded sessions" };
  if (input.e2bAvailable) return { mode: "e2b", reason: "INTEGRATIONS_MODE=live and E2B_API_KEY is set" };
  if (input.dockerAvailable) return { mode: "docker", reason: "INTEGRATIONS_MODE=live, no E2B key, local docker daemon reachable" };
  return { mode: null, reason: "INTEGRATIONS_MODE=live but neither E2B_API_KEY nor a docker daemon is available" };
}

export interface GetSandboxProviderOptions {
  /** Force a runner. Default: derived from `INTEGRATIONS_MODE` and availability. */
  mode?: SandboxMode | string | undefined;
  /** Environment slice; default `loadEnv()`. */
  env?: { INTEGRATIONS_MODE: "mock" | "live"; E2B_API_KEY?: string | undefined };
  /** When nothing is available (or the requested mode is not), use this runner instead of throwing. */
  fallback?: SandboxMode;
  mock?: MockSandboxOptions;
  docker?: DockerSandboxOptions;
  e2b?: E2bSandboxOptions;
  /** Pre-built providers (tests, or a process that keeps one Docker probe cache). */
  providers?: Partial<Record<SandboxMode, SandboxProvider>>;
}

export interface ResolvedSandboxProvider {
  provider: SandboxProvider;
  mode: SandboxMode;
  reason: string;
  /** Set when `fallback` was used. */
  fellBackFrom: string | null;
}

function buildProviders(opts: GetSandboxProviderOptions, env: NonNullable<GetSandboxProviderOptions["env"]>): Record<SandboxMode, SandboxProvider> {
  return {
    mock: opts.providers?.mock ?? new MockSandboxProvider(opts.mock),
    docker: opts.providers?.docker ?? new DockerSandboxProvider(opts.docker),
    e2b: opts.providers?.e2b ?? new E2bSandboxProvider({ ...(env.E2B_API_KEY ? { apiKey: env.E2B_API_KEY } : {}), ...opts.e2b }),
  };
}

/** Pick and return the provider for this process. Throws `SandboxUnavailableError` when nothing fits. */
export async function resolveSandboxProvider(opts: GetSandboxProviderOptions = {}): Promise<ResolvedSandboxProvider> {
  const env = opts.env ?? loadEnv();
  const providers = buildProviders(opts, env);
  const requested = opts.mode === undefined ? undefined : SandboxModeSchema.parse(opts.mode);
  // Probe only what the decision needs: mock needs nothing; a requested mode needs itself; live needs e2b then docker.
  const needE2b = requested === "e2b" || (requested === undefined && env.INTEGRATIONS_MODE === "live");
  const e2bAvailable = needE2b ? (await providers.e2b.available()).available : false;
  const needDocker = requested === "docker" || (requested === undefined && env.INTEGRATIONS_MODE === "live" && !e2bAvailable);
  const dockerAvailable = needDocker ? (await providers.docker.available()).available : false;
  const selection = resolveSandboxMode({ integrationsMode: env.INTEGRATIONS_MODE, requested, e2bAvailable, dockerAvailable });
  if (selection.mode) return { provider: providers[selection.mode], mode: selection.mode, reason: selection.reason, fellBackFrom: null };
  if (opts.fallback) {
    const fb = providers[opts.fallback];
    const avail = await fb.available();
    if (avail.available) return { provider: fb, mode: opts.fallback, reason: `${selection.reason}; using fallback ${opts.fallback}`, fellBackFrom: requested ?? env.INTEGRATIONS_MODE };
    throw new SandboxUnavailableError(opts.fallback, `${selection.reason}; fallback ${opts.fallback} is also unavailable: ${avail.reason ?? ""}`.trim());
  }
  throw new SandboxUnavailableError(requested ?? "sandbox", selection.reason);
}

/** The common entry point: `getSandboxProvider()` or `getSandboxProvider("docker")`. */
export async function getSandboxProvider(mode?: SandboxMode | string, opts: Omit<GetSandboxProviderOptions, "mode"> = {}): Promise<SandboxProvider> {
  const resolved = await resolveSandboxProvider({ ...opts, ...(mode === undefined ? {} : { mode }) });
  return resolved.provider;
}

export interface SandboxProviderReport {
  mode: SandboxMode;
  availability: ProviderAvailability;
}

/** Availability of every runner (Settings → Environments, health checks). Never throws. */
export async function describeSandboxProviders(opts: GetSandboxProviderOptions = {}): Promise<SandboxProviderReport[]> {
  const env = opts.env ?? loadEnv();
  const providers = buildProviders(opts, env);
  const modes: SandboxMode[] = ["mock", "docker", "e2b"];
  return Promise.all(
    modes.map(async (mode) => ({
      mode,
      availability: await providers[mode].available().catch((err: unknown): ProviderAvailability => ({ available: false, reason: err instanceof Error ? err.message : String(err) })),
    })),
  );
}
