import { describe, expect, it } from "vitest";
import { capturePages, NO_BROWSER_EXIT, NOT_SERVING_EXIT, safeRoute, SIMULATED_CAPTURE_NOTICE } from "../browser";
import { MockSandboxProvider } from "../mock/replay";
import type { ExecResult, Sandbox, SandboxMode } from "../types";

const ok = (stdout = ""): ExecResult => ({ code: 0, stdout, stderr: "", timedOut: false, durationMs: 1 });

/** A sandbox that records commands and answers the capture run with `onCapture`. */
function fakeSandbox(onCapture: (files: Map<string, string>) => ExecResult, provider: SandboxMode = "docker") {
  const files = new Map<string, string>();
  const commands: string[] = [];
  const sandbox: Sandbox = {
    id: "sb1",
    provider,
    spec: { businessId: "b", taskId: "t", egressAllowList: [], envShortLived: {}, ttlMinutes: 30 },
    workdir: "/workspace",
    state: "running",
    async start() {},
    async exec(cmd) {
      commands.push(cmd);
      if (cmd.includes("capture.mjs")) return onCapture(files);
      return ok();
    },
    async writeFile(path, content) {
      files.set(path, typeof content === "string" ? content : new TextDecoder().decode(content));
    },
    async readFile(path) {
      const f = files.get(path);
      if (f === undefined) throw new Error(`no file ${path}`);
      return f;
    },
    async listFiles() {
      return [];
    },
    async snapshot() {
      return { id: "s", sandboxId: "sb1", provider, ref: "r", createdAt: new Date(0).toISOString() };
    },
    async closeEgress() {},
    async stop() {},
  };
  return { sandbox, files, commands };
}

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const description = (page: string, viewport: "desktop" | "phone") => ({ page, viewport, widthPx: viewport === "phone" ? 390 : 1440, scrollWidthPx: 1440, title: "Shop", elements: [{ ref: "main > h1", role: "heading", level: 1, text: "Shop", fontSizePx: 32, color: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)" }] });

describe("capturePages (the sandbox's browser capability)", () => {
  it("in mock mode takes no screenshot and says it was simulated", async () => {
    const provider = new MockSandboxProvider();
    const sandbox = await provider.create({ businessId: "b", taskId: "t" });
    const r = await capturePages(sandbox, { pages: ["/", "/pricing"], serve: { command: "npm run dev", port: 3000 } });
    expect(r).toEqual({ status: "simulated", notice: SIMULATED_CAPTURE_NOTICE, pages: [{ page: "/", viewport: "desktop" }, { page: "/", viewport: "phone" }, { page: "/pricing", viewport: "desktop" }, { page: "/pricing", viewport: "phone" }] });
    expect(r.status === "simulated" && "shots" in r).toBe(false);
  });

  it("reads each shot and its page description, and records pages that failed", async () => {
    const { sandbox, commands, files } = fakeSandbox((f) => {
      f.set(
        "/tmp/fm-capture/shots.jsonl",
        [
          { page: "/", viewport: "desktop", ok: true, width: 1440, height: 900, cut: false, png: PNG, description: description("/", "desktop") },
          { page: "/", viewport: "phone", ok: true, width: 390, height: 2532, cut: true, png: PNG, description: description("/", "phone") },
          { page: "/pricing", viewport: "desktop", ok: false, reason: "Timeout 30000ms exceeded" },
          { page: "/pricing", viewport: "phone", ok: true, width: 390, height: 844, png: "!!not base64!!" },
        ]
          .map((l) => JSON.stringify(l))
          .join("\n"),
      );
      return ok();
    });
    const r = await capturePages(sandbox, { pages: ["/", "/pricing", "https://evil.example/", "/"], serve: { command: "pnpm dev", port: 3000 }, label: "before" });
    expect(r.status).toBe("captured");
    if (r.status !== "captured") return;
    expect(r.shots.map((s) => [s.id, s.page, s.viewport, s.cut])).toEqual([
      ["before-1-desktop", "/", "desktop", false],
      ["before-1-phone", "/", "phone", true],
    ]);
    expect(r.shots[0]!.description?.elements[0]?.text).toBe("Shop");
    expect(r.failed).toEqual([
      { page: "/pricing", viewport: "desktop", reason: "Timeout 30000ms exceeded" },
      { page: "/pricing", viewport: "phone", reason: "no screenshot came back" },
    ]);
    // The off-site route is dropped before it reaches the browser; the server is started in the background and stopped after.
    expect(JSON.parse(files.get("/tmp/fm-capture/config.json")!).pages).toEqual(["/", "/pricing"]);
    expect(commands.some((c) => c.includes("setsid nohup sh -c 'pnpm dev'") && c.includes("PORT=3000"))).toBe(true);
    expect(commands.at(-1)).toMatch(/kill -- -\$\(cat \/tmp\/fm-capture\/serve.pid\)/);
  });

  it("says plainly when the image has no browser or the project never started", async () => {
    const noBrowser = fakeSandbox(() => ({ code: NO_BROWSER_EXIT, stdout: "", stderr: "FM_NO_BROWSER", timedOut: false, durationMs: 1 }));
    const a = await capturePages(noBrowser.sandbox, { pages: ["/"], serve: { command: "npm start", port: 3000 } });
    expect(a).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/no browser/) });
    const notServing = fakeSandbox((f) => {
      f.set("/tmp/fm-capture/serve.log", "Error: Cannot find module 'next'\n");
      return { code: NOT_SERVING_EXIT, stdout: "", stderr: "", timedOut: false, durationMs: 1 };
    });
    const b = await capturePages(notServing.sandbox, { pages: ["/"], serve: { command: "npm start", port: 3000 } });
    expect(b).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/did not start on port 3000: Error: Cannot find module 'next'/) });
    const nothing = await capturePages(fakeSandbox(() => ok()).sandbox, { pages: ["javascript:alert(1)"], serve: { command: "npm start", port: 3000 } });
    expect(nothing).toMatchObject({ status: "unavailable", reason: expect.stringMatching(/no page to open/) });
  });

  it("opens only paths on the project's own server", () => {
    expect(safeRoute("/pricing?plan=pro")).toBe("/pricing?plan=pro");
    expect(safeRoute("//evil.example")).toBeNull();
    expect(safeRoute("https://evil.example")).toBeNull();
    expect(safeRoute("/a b")).toBeNull();
    expect(safeRoute("/'; rm -rf /")).toBeNull();
  });
});
