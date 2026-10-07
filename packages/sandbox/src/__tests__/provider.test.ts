import { describe, expect, it } from "vitest";
import { DockerSandboxProvider, type DockerCommandRunner } from "../docker";
import { E2bSandboxProvider } from "../e2b";
import { SandboxUnavailableError } from "../errors";
import { MockSandboxProvider } from "../mock/replay";
import { describeSandboxProviders, getSandboxProvider, resolveSandboxMode, resolveSandboxProvider } from "../provider";

const noDocker: DockerCommandRunner = async () => ({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: { code: "ENOENT", message: "spawn docker ENOENT" } });
const withDocker: DockerCommandRunner = async (args) => (args[0] === "version" ? { code: 0, stdout: "29.8.2\n", stderr: "", timedOut: false } : { code: 1, stdout: "", stderr: "", timedOut: false });

describe("resolveSandboxMode", () => {
  it("mock mode always replays", () => {
    expect(resolveSandboxMode({ integrationsMode: "mock", e2bAvailable: true, dockerAvailable: true }).mode).toBe("mock");
  });
  it("live mode prefers e2b, then docker, then nothing", () => {
    expect(resolveSandboxMode({ integrationsMode: "live", e2bAvailable: true, dockerAvailable: true }).mode).toBe("e2b");
    expect(resolveSandboxMode({ integrationsMode: "live", e2bAvailable: false, dockerAvailable: true }).mode).toBe("docker");
    expect(resolveSandboxMode({ integrationsMode: "live", e2bAvailable: false, dockerAvailable: false })).toEqual({ mode: null, reason: expect.stringMatching(/neither/) });
  });
  it("an explicit request wins when available", () => {
    expect(resolveSandboxMode({ integrationsMode: "mock", requested: "docker", e2bAvailable: false, dockerAvailable: true }).mode).toBe("docker");
    expect(resolveSandboxMode({ integrationsMode: "live", requested: "mock", e2bAvailable: true, dockerAvailable: true }).mode).toBe("mock");
    expect(resolveSandboxMode({ integrationsMode: "live", requested: "e2b", e2bAvailable: false, dockerAvailable: true }).mode).toBeNull();
  });
});

describe("getSandboxProvider", () => {
  it("returns the mock provider under INTEGRATIONS_MODE=mock without probing docker or e2b", async () => {
    let probed = 0;
    const docker = new DockerSandboxProvider({ run: async (a, o) => (probed++, noDocker(a, o)) });
    const provider = await getSandboxProvider(undefined, { env: { INTEGRATIONS_MODE: "mock", E2B_API_KEY: "e2b_x" }, providers: { docker } });
    expect(provider).toBeInstanceOf(MockSandboxProvider);
    expect(provider.mode).toBe("mock");
    expect(probed).toBe(0);
  });

  it("live: e2b when a key exists", async () => {
    const r = await resolveSandboxProvider({ env: { INTEGRATIONS_MODE: "live", E2B_API_KEY: "e2b_key" }, docker: { run: noDocker } });
    expect(r.provider).toBeInstanceOf(E2bSandboxProvider);
    expect(r).toMatchObject({ mode: "e2b", fellBackFrom: null });
  });

  it("live: docker when there is no key but a daemon", async () => {
    const r = await resolveSandboxProvider({ env: { INTEGRATIONS_MODE: "live" }, docker: { run: withDocker } });
    expect(r.provider).toBeInstanceOf(DockerSandboxProvider);
    expect(r.mode).toBe("docker");
  });

  it("live: throws SandboxUnavailableError when nothing is available, unless a fallback is named", async () => {
    await expect(resolveSandboxProvider({ env: { INTEGRATIONS_MODE: "live" }, docker: { run: noDocker } })).rejects.toBeInstanceOf(SandboxUnavailableError);
    const r = await resolveSandboxProvider({ env: { INTEGRATIONS_MODE: "live" }, docker: { run: noDocker }, fallback: "mock" });
    expect(r).toMatchObject({ mode: "mock", fellBackFrom: "live" });
    expect(r.reason).toMatch(/using fallback mock/);
  });

  it("an explicit mode is honoured and validated", async () => {
    expect((await getSandboxProvider("docker", { env: { INTEGRATIONS_MODE: "mock" }, docker: { run: withDocker } })).mode).toBe("docker");
    await expect(getSandboxProvider("docker", { env: { INTEGRATIONS_MODE: "mock" }, docker: { run: noDocker } })).rejects.toMatchObject({ provider: "docker", status: 503 });
    await expect(getSandboxProvider("podman", { env: { INTEGRATIONS_MODE: "mock" } })).rejects.toThrow();
    const e2b = await getSandboxProvider("e2b", { env: { INTEGRATIONS_MODE: "mock" }, e2b: { factory: async () => Promise.reject(new Error("unused")) } });
    expect(e2b.mode).toBe("e2b");
  });

  it("describeSandboxProviders reports every runner without throwing", async () => {
    const report = await describeSandboxProviders({ env: { INTEGRATIONS_MODE: "live" }, docker: { run: noDocker } });
    expect(report.map((r) => r.mode)).toEqual(["mock", "docker", "e2b"]);
    expect(report[0]!.availability.available).toBe(true);
    expect(report[1]!.availability).toMatchObject({ available: false, reason: expect.stringMatching(/not installed/) });
    expect(report[2]!.availability).toMatchObject({ available: false, reason: expect.stringMatching(/E2B_API_KEY/) });
  });
});
