import { describe, expect, it } from "vitest";
import { CLI_COMMANDS, createCliConnector, createCliMock } from "./index";
import type { CliRunner } from "../../platform";

const ctx = (businessId: string) => ({ businessId, agentId: "a", sessionId: null, integration: {} as never, log: { debug() {}, info() {}, warn() {}, error() {} } as never }) as never;

describe("cli connectors", () => {
  it("refuses a file name that is a path", async () => {
    const t = CLI_COMMANDS.inkscape.find((c) => c.spec.name === "export")!;
    expect((t.spec.input as never as { safeParse: (v: unknown) => { success: boolean } }).safeParse({ format: "svg", output: "../x.svg" }).success).toBe(false);
  });
  it("mock says simulated, stages the file and releases only what it made", async () => {
    const mock = createCliMock("inkscape");
    const made = await mock.callTool("export", { format: "svg", output: "logo.svg" }, ctx("b1"));
    expect(JSON.stringify(made)).toContain("simulated");
    await expect(mock.callTool("release_output", { path: "other.svg", target: "logo" }, ctx("b1"))).resolves.toMatchObject({ ok: false });
    await expect(mock.callTool("release_output", { path: "logo.svg", target: "logo" }, ctx("b2"))).resolves.toMatchObject({ ok: false });
    expect(JSON.stringify(await mock.callTool("release_output", { path: "logo.svg", target: "logo" }, ctx("b1")))).toContain('"released":true');
  });
  it("release_output and making a file run with no approval (founder, Nov 23, 2026)", () => {
    const c = createCliConnector("inkscape");
    expect(c.policyHints.release_output).toEqual({});
    expect(c.policyHints.export).toEqual({});
  });
  it("live runs through the host runner in the business's own folder, and fails without one", async () => {
    const seen: unknown[] = [];
    const runner: CliRunner = { run: async (i) => { seen.push(i); return { ok: true, summary: "{}", stderr: "", produced: [{ path: "logo.svg", bytes: 9 }] }; }, release: async (i) => ({ released: true, target: i.target, path: i.path, where: "x" }) };
    const live = createCliConnector("inkscape", { cliRunner: runner });
    const r = await live.callTool("export", { format: "svg", output: "logo.svg" }, ctx("b1"));
    expect(JSON.stringify(r)).toContain("logo.svg");
    expect(seen[0]).toMatchObject({ program: "inkscape", argv: ["export", "svg", "logo.svg", "--overwrite"] });
    await expect(createCliConnector("inkscape").callTool("export", { format: "svg", output: "logo.svg" }, ctx("b1"))).rejects.toThrow(/not configured/);
  });
});
